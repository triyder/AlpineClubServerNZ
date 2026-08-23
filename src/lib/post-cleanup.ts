import "server-only";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loadPostSettings } from "@/lib/settings";
import { deleteStoredImage, uploadsRoot } from "@/lib/uploads";

/**
 * Nightly retention pass for the Communication Portal.
 *
 * Two stages, and the split is the point:
 *
 *  - EXPIRE turns an old post into a tombstone (content blanked, files gone,
 *    `removedAt` set) rather than deleting the row. Mirrors poll a cursor, so a
 *    row that simply vanished would be indistinguishable from one that never
 *    changed and every club would keep serving the post forever. Expiring via
 *    the same removal channel every other takedown uses means retention is
 *    something clubs are TOLD about, not something they are trusted to apply.
 *
 *  - PRUNE deletes those stubs once the tombstone horizon has passed, by which
 *    point every club that is going to hear has heard.
 */

export const CLEANUP_JOB = "posts.cleanup";

/**
 * Generous relative to a real pass. Reaping early is merely wasteful — two
 * overlapping passes — whereas reaping late leaves a wedged job, and a wedged
 * job is silent.
 */
const STALE_CLAIM_AFTER_MS = 30 * 60 * 1000;

/** Files younger than this are left alone: an upload may be mid-flight. */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface CleanupStats {
  skipped?: "disabled" | "already-running";
  expired: number;
  stubsPruned: number;
  imagesDeleted: number;
  filesUnlinked: number;
  skippedUnderReview: number;
  orphansCollected: number;
  durationMs: number;
}

const EMPTY: Omit<CleanupStats, "skipped" | "durationMs"> = {
  expired: 0,
  stubsPruned: 0,
  imagesDeleted: 0,
  filesUnlinked: 0,
  skippedUnderReview: 0,
  orphansCollected: 0,
};

/**
 * Take the single-flight claim, run `fn`, release it.
 *
 * Deliberately NOT a Postgres advisory lock. A session-scoped lock is taken and
 * released through Prisma's connection POOL, so the unlock can execute on a
 * different connection than the lock, leaving the job wedged until the pool
 * recycles — silently. An xact-scoped lock releases at commit, which would mean
 * holding a transaction open across filesystem I/O. A conditional update whose
 * matched-row count IS the claim has neither problem.
 */
async function withCleanupClaim<T>(
  now: Date,
  fn: () => Promise<T>,
): Promise<T | null> {
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_AFTER_MS);

  const claim = await prisma.jobClaim.updateMany({
    where: {
      name: CLEANUP_JOB,
      OR: [{ startedAt: null }, { startedAt: { lt: staleCutoff } }],
    },
    data: { startedAt: now },
  });

  // count === 1 means THIS caller moved the row from "free or stale" to "held",
  // atomically. A concurrent caller matched zero rows and does nothing — which
  // is what stops the console's "Run cleanup now" racing the 02:00 cron.
  if (claim.count === 0) return null;

  try {
    return await fn();
  } finally {
    // Release regardless of outcome: a failed pass must not wedge the next one.
    await prisma.jobClaim
      .update({ where: { name: CLEANUP_JOB }, data: { startedAt: null } })
      .catch((err) => {
        // Not fatal — the staleness reap above recovers it within the window.
        logger.error({ err }, "failed to release posts.cleanup claim");
      });
  }
}

/** Blank and tombstone every post past the retention window. */
async function expireOldPosts(cutoff: Date) {
  // Posts with open reports are evidence: expiring one destroys the case
  // before anyone has ruled on it, so they are left for the admin instead.
  const candidates = await prisma.post.findMany({
    where: {
      createdAt: { lt: cutoff },
      removedAt: null,
      reports: { none: { dismissedAt: null } },
    },
    select: { id: true, images: { select: { storageKey: true } } },
  });

  const underReview = await prisma.post.count({
    where: {
      createdAt: { lt: cutoff },
      removedAt: null,
      reports: { some: { dismissedAt: null } },
    },
  });

  let imagesDeleted = 0;
  let filesUnlinked = 0;

  for (const post of candidates) {
    const keys = post.images.map((i) => i.storageKey);

    // Rows first, files second — see post-removal.ts for why this order.
    const [, deleted] = await prisma.$transaction([
      prisma.post.update({
        where: { id: post.id },
        data: {
          content: "",
          authorEmail: null,
          removedAt: new Date(),
          removedBy: "RETENTION",
        },
      }),
      prisma.postImage.deleteMany({ where: { postId: post.id } }),
    ]);
    imagesDeleted += deleted.count;

    for (const key of keys) {
      try {
        if (await deleteStoredImage(key)) filesUnlinked++;
      } catch (err) {
        // The rows are gone, so the post is expired as far as every club is
        // concerned. The leftover file becomes an orphan the sweep collects.
        logger.error({ err, key }, "failed to unlink expired post image");
      }
    }
  }

  return {
    expired: candidates.length,
    imagesDeleted,
    filesUnlinked,
    skippedUnderReview: underReview,
  };
}

/**
 * Delete tombstone stubs past the horizon. These already carry no content and
 * no files; they exist only to tell mirrors to drop their copy.
 */
async function pruneStubs(horizon: Date): Promise<number> {
  const { count } = await prisma.post.deleteMany({
    where: { removedAt: { lt: horizon } },
  });
  return count;
}

/**
 * Delete files under UPLOADS_DIR with no matching row.
 *
 * Collects both the leftovers of a crash between the row write and the unlink,
 * and derivatives written by an upload whose transaction later rolled back.
 */
async function collectOrphans(now: Date): Promise<number> {
  const root = uploadsRoot();
  let collected = 0;

  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }

  for (const entry of entries) {
    const absolute = path.join(root, entry);

    let info;
    try {
      info = await stat(absolute);
    } catch {
      continue; // vanished mid-sweep; nothing to do
    }
    if (!info.isFile()) continue;

    // Leave anything recent alone: an upload may be between writing its file
    // and committing its row, and deleting it would break a live post.
    if (now.getTime() - info.mtimeMs < ORPHAN_MIN_AGE_MS) continue;

    const key = entry.split(path.sep).join("/");
    const referenced = await prisma.postImage.findFirst({
      where: { storageKey: key },
      select: { id: true },
    });
    if (referenced) continue;

    try {
      await unlink(absolute);
      collected++;
    } catch (err) {
      logger.error({ err, key }, "failed to unlink orphaned image file");
    }
  }

  return collected;
}

/**
 * Run the retention pass. Safe to call concurrently: only one caller does the
 * work, the rest return `skipped: "already-running"`.
 */
export async function runPostCleanup(
  options: { trigger: "cron" | "manual"; now?: Date } = { trigger: "manual" },
): Promise<CleanupStats> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();

  const result = await withCleanupClaim(now, async () => {
    const settings = await loadPostSettings();

    // Prune stubs even when retention is disabled: the horizon is about mirror
    // convergence, not about how long content lives, so tombstones from admin
    // and club removals must still expire.
    const horizon = new Date(
      now.getTime() - settings.tombstoneHorizonDays * 24 * 60 * 60 * 1000,
    );

    const expiry =
      settings.retentionDays > 0
        ? await expireOldPosts(
            new Date(now.getTime() - settings.retentionDays * 24 * 60 * 60 * 1000),
          )
        : {
            expired: 0,
            imagesDeleted: 0,
            filesUnlinked: 0,
            skippedUnderReview: 0,
          };

    const stubsPruned = await pruneStubs(horizon);
    const orphansCollected = await collectOrphans(now);

    return {
      ...expiry,
      stubsPruned,
      orphansCollected,
      ...(settings.retentionDays === 0 ? { skipped: "disabled" as const } : {}),
    };
  });

  if (result === null) {
    return {
      ...EMPTY,
      skipped: "already-running",
      durationMs: Date.now() - startedAt,
    };
  }

  const stats: CleanupStats = {
    ...EMPTY,
    ...result,
    durationMs: Date.now() - startedAt,
  };

  logger.info({ ...stats, trigger: options.trigger }, "posts cleanup complete");
  return stats;
}
