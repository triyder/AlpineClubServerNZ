import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = vi.fn();
vi.mock("@/lib/settings", () => ({ loadPostSettings: () => settings() }));

const deleteStoredImage = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/uploads", () => ({
  deleteStoredImage: (...a: unknown[]) => deleteStoredImage(...a),
  uploadsRoot: () => "/nonexistent-uploads-root",
}));

const claimUpdateMany = vi.fn();
const claimUpdate = vi.fn().mockResolvedValue({});
const postFindMany = vi.fn();
const postCount = vi.fn();
const postDeleteMany = vi.fn();
const postUpdate = vi.fn();
const imageDeleteMany = vi.fn();
const imageFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    jobClaim: {
      updateMany: (...a: unknown[]) => claimUpdateMany(...a),
      update: (...a: unknown[]) => claimUpdate(...a),
    },
    post: {
      findMany: (...a: unknown[]) => postFindMany(...a),
      count: (...a: unknown[]) => postCount(...a),
      deleteMany: (...a: unknown[]) => postDeleteMany(...a),
      update: (...a: unknown[]) => postUpdate(...a),
    },
    postImage: {
      deleteMany: (...a: unknown[]) => imageDeleteMany(...a),
      findFirst: (...a: unknown[]) => imageFindFirst(...a),
    },
    // The pass batches its row writes; the mock just resolves the array.
    $transaction: (ops: unknown[]) => Promise.all(ops),
  },
}));

import { runPostCleanup, CLEANUP_JOB } from "@/lib/post-cleanup";

const NOW = new Date("2026-08-22T02:00:00.000Z");

function claimGranted() {
  claimUpdateMany.mockResolvedValue({ count: 1 });
}

beforeEach(() => {
  claimUpdateMany.mockReset();
  claimUpdate.mockReset().mockResolvedValue({});
  postFindMany.mockReset().mockResolvedValue([]);
  postCount.mockReset().mockResolvedValue(0);
  postDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  postUpdate.mockReset().mockResolvedValue({});
  imageDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  imageFindFirst.mockReset().mockResolvedValue(null);
  deleteStoredImage.mockReset().mockResolvedValue(true);
  settings.mockReset().mockResolvedValue({
    retentionDays: 365,
    autoHideThreshold: 3,
    autoHideMinClubs: 1,
    tombstoneHorizonDays: 90,
  });
  claimGranted();
});

describe("post-cleanup — the single-flight claim", () => {
  it("does nothing when another pass holds the claim", async () => {
    claimUpdateMany.mockResolvedValue({ count: 0 });

    const stats = await runPostCleanup({ trigger: "manual", now: NOW });

    expect(stats.skipped).toBe("already-running");
    expect(postFindMany).not.toHaveBeenCalled();
    // Nothing was claimed, so nothing may be released — releasing here would
    // free the claim the OTHER pass is holding.
    expect(claimUpdate).not.toHaveBeenCalled();
  });

  it("claims a free or stale row, and reaps a wedged one", async () => {
    await runPostCleanup({ trigger: "manual", now: NOW });

    const where = claimUpdateMany.mock.calls[0][0].where;
    expect(where.name).toBe(CLEANUP_JOB);
    // A container killed mid-pass would otherwise hold the claim forever, so
    // staleness is what recovers it rather than a separate sweeper.
    expect(where.OR[0]).toEqual({ startedAt: null });
    expect(where.OR[1].startedAt.lt).toBeInstanceOf(Date);
    expect(where.OR[1].startedAt.lt.getTime()).toBe(
      NOW.getTime() - 30 * 60 * 1000,
    );
  });

  it("releases the claim even when the pass throws", async () => {
    postFindMany.mockRejectedValue(new Error("database went away"));

    await expect(
      runPostCleanup({ trigger: "manual", now: NOW }),
    ).rejects.toThrow("database went away");

    // A failed pass must not wedge the next one.
    expect(claimUpdate).toHaveBeenCalledWith({
      where: { name: CLEANUP_JOB },
      data: { startedAt: null },
    });
  });
});

describe("post-cleanup — retention", () => {
  it("expires nothing when retention is disabled, but still prunes stubs", async () => {
    settings.mockResolvedValue({
      retentionDays: 0,
      autoHideThreshold: 3,
      autoHideMinClubs: 1,
      tombstoneHorizonDays: 90,
    });
    postDeleteMany.mockResolvedValue({ count: 4 });

    const stats = await runPostCleanup({ trigger: "manual", now: NOW });

    expect(stats.skipped).toBe("disabled");
    expect(stats.expired).toBe(0);
    // The horizon governs mirror convergence, not how long content lives, so
    // tombstones from admin and club removals must still expire.
    expect(stats.stubsPruned).toBe(4);
  });

  it("expires by tombstone rather than deleting the row", async () => {
    postFindMany.mockResolvedValue([
      { id: "p1", images: [{ storageKey: "posts/2026/01/a.webp" }] },
    ]);
    imageDeleteMany.mockResolvedValue({ count: 1 });

    const stats = await runPostCleanup({ trigger: "manual", now: NOW });

    expect(stats.expired).toBe(1);
    // Deleting the row outright would be indistinguishable, to a mirror
    // polling a cursor, from a row that never changed — so every club would
    // keep serving the post forever.
    expect(postUpdate).toHaveBeenCalledTimes(1);
    const data = postUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      content: "",
      authorEmail: null,
      removedBy: "RETENTION",
    });
    expect(data.removedAt).toBeInstanceOf(Date);
    expect(deleteStoredImage).toHaveBeenCalledWith("posts/2026/01/a.webp");
  });

  it("leaves posts with open reports alone and counts them", async () => {
    postCount.mockResolvedValue(2);

    const stats = await runPostCleanup({ trigger: "manual", now: NOW });

    // A post in the queue is evidence: expiring it destroys the case before
    // anyone has ruled on it.
    expect(postFindMany.mock.calls[0][0].where.reports).toEqual({
      none: { dismissedAt: null },
    });
    expect(stats.skippedUnderReview).toBe(2);
  });

  it("computes the retention cutoff from the configured window", async () => {
    await runPostCleanup({ trigger: "manual", now: NOW });
    const cutoff = postFindMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(cutoff.getTime()).toBe(NOW.getTime() - 365 * 24 * 3600 * 1000);
  });

  it("prunes only stubs past the horizon", async () => {
    await runPostCleanup({ trigger: "manual", now: NOW });
    const cutoff = postDeleteMany.mock.calls[0][0].where.removedAt.lt as Date;
    expect(cutoff.getTime()).toBe(NOW.getTime() - 90 * 24 * 3600 * 1000);
  });

  it("keeps going when one file cannot be unlinked", async () => {
    postFindMany.mockResolvedValue([
      { id: "p1", images: [{ storageKey: "a.webp" }, { storageKey: "b.webp" }] },
    ]);
    deleteStoredImage
      .mockRejectedValueOnce(new Error("EBUSY"))
      .mockResolvedValueOnce(true);

    const stats = await runPostCleanup({ trigger: "manual", now: NOW });

    // The rows are already gone, so the post is expired as far as every club
    // is concerned; the stranded file becomes an orphan the sweep collects.
    expect(stats.expired).toBe(1);
    expect(stats.filesUnlinked).toBe(1);
  });
});
