import "server-only";
import { Prisma, type Club } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { SERVER_API_VERSION } from "@/lib/api-version";
import { checkRateLimit } from "@/lib/rate-limit";

export const VERSION_MISMATCH_KIND = "VERSION_MISMATCH";

function openKeyFor(clubId: string, kind: string): string {
  return `${clubId}:${kind}`;
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/**
 * How many version-problem recordings (the club stamp, the issue upsert and the
 * audit row) one token may cause per window. A mismatching or malformed request
 * is refused before any route's own limiter runs, so without this a club on the
 * wrong version — or anyone holding its token — could turn every request into
 * three database writes. Over the limit the request is still refused; only the
 * recording is skipped, and nothing is lost: the next window records again.
 */
export const VERSION_RECORDING_MAX_PER_MINUTE = 10;
const VERSION_RECORDING_WINDOW_MS = 60_000;

/** True while this token is still within its recording allowance. */
export function allowVersionRecording(tokenId: string): boolean {
  return checkRateLimit(
    `version-gate:${tokenId}`,
    Date.now(),
    VERSION_RECORDING_MAX_PER_MINUTE,
    VERSION_RECORDING_WINDOW_MS,
  ).allowed;
}

/**
 * Open — or refresh — the one open version-mismatch issue for a club.
 *
 * Atomic through the unique `openKey`: two requests racing from one club cannot
 * leave two open rows. The loser of a create race gets P2002 and falls through
 * to the update the winner's row needs, which is exactly what it would have
 * done had it arrived second.
 *
 * The update can itself find nothing (P2025) when an administrator clears the
 * issue — which nulls its `openKey` — in the instant between the two. That is
 * the "cleared club mismatches again" case, so the upsert is tried once more
 * to open the fresh issue; a second miss is surfaced rather than retried
 * forever.
 */
export async function recordVersionMismatch(input: {
  clubId: string;
  clientVersion: string | null;
}): Promise<void> {
  const openKey = openKeyFor(input.clubId, VERSION_MISMATCH_KIND);
  const now = new Date();
  const refresh = {
    lastSeenAt: now,
    occurrences: { increment: 1 },
    clientVersion: input.clientVersion,
    serverVersion: SERVER_API_VERSION,
  };
  const ATTEMPTS = 2;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await prisma.syncIssue.upsert({
        where: { openKey },
        create: {
          kind: VERSION_MISMATCH_KIND,
          clubId: input.clubId,
          clientVersion: input.clientVersion,
          serverVersion: SERVER_API_VERSION,
          firstSeenAt: now,
          lastSeenAt: now,
          openKey,
        },
        update: refresh,
      });
      return;
    } catch (error) {
      if (!isPrismaError(error, "P2002")) throw error;
      try {
        await prisma.syncIssue.update({ where: { openKey }, data: refresh });
        return;
      } catch (updateError) {
        if (!isPrismaError(updateError, "P2025") || attempt === ATTEMPTS) {
          throw updateError;
        }
        // Cleared between the upsert and the update: go round once more.
      }
    }
  }
}

/** A `lastVersionCheckAt` older than this is refreshed on the next request. */
export const VERSION_STAMP_STALE_MS = 60 * 60 * 1000;

/**
 * Stamp what a club reported. Written when the value changed, on an explicit
 * version check, or when the stored time is missing or older than an hour —
 * so "last checked" on the Clubs screen stays roughly current without an
 * ordinary request adding a write. The club row is already loaded by
 * authentication, so deciding costs no extra read.
 */
export async function stampReportedVersion(
  club: Pick<Club, "id" | "lastReportedApiVersion" | "lastVersionCheckAt">,
  clientVersion: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const checkedAt = club.lastVersionCheckAt?.getTime() ?? null;
  const stale =
    checkedAt === null || Date.now() - checkedAt >= VERSION_STAMP_STALE_MS;
  if (!force && !stale && club.lastReportedApiVersion === clientVersion) return;
  await prisma.club.update({
    where: { id: club.id },
    data: {
      lastReportedApiVersion: clientVersion,
      lastVersionCheckAt: new Date(),
    },
  });
}

/** The audit row for a mismatch — the non-success one an admin filters for. */
export async function auditVersionMismatch(input: {
  clubId: string;
  tokenId: string;
  ipAddress: string | null;
  userAgent: string | null;
  clientVersion: string | null;
  path: string;
}): Promise<void> {
  await recordAudit({
    action: "api.version.mismatch",
    outcome: "FAILURE",
    clubId: input.clubId,
    tokenId: input.tokenId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      clientVersion: input.clientVersion,
      serverVersion: SERVER_API_VERSION,
      path: input.path,
    },
  });
}

/**
 * The audit row for a malformed declared version. A 400 with no trail would
 * leave a club whose site sends a broken header invisible on /audit and
 * /issues alike; `declared` is already length-capped and control-stripped.
 */
export async function auditInvalidVersion(input: {
  clubId: string;
  tokenId: string;
  ipAddress: string | null;
  userAgent: string | null;
  declared: string;
  path: string;
}): Promise<void> {
  await recordAudit({
    action: "api.version.invalid",
    outcome: "FAILURE",
    clubId: input.clubId,
    tokenId: input.tokenId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      declared: input.declared,
      serverVersion: SERVER_API_VERSION,
      path: input.path,
    },
  });
}
