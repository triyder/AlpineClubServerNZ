import "server-only";
import { Prisma, type Club } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { SERVER_API_VERSION } from "@/lib/api-version";

export const VERSION_MISMATCH_KIND = "VERSION_MISMATCH";

function openKeyFor(clubId: string, kind: string): string {
  return `${clubId}:${kind}`;
}

/**
 * Open — or refresh — the one open version-mismatch issue for a club.
 *
 * Atomic through the unique `openKey`: two requests racing from one club cannot
 * leave two open rows. The loser of a create race gets P2002 and falls through
 * to the update the winner's row needs, which is exactly what it would have
 * done had it arrived second.
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
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      await prisma.syncIssue.update({ where: { openKey }, data: refresh });
      return;
    }
    throw error;
  }
}

/**
 * Stamp what a club reported. Written only when the value changed (or on an
 * explicit version check), so an ordinary request does not add a write.
 */
export async function stampReportedVersion(
  club: Pick<Club, "id" | "lastReportedApiVersion">,
  clientVersion: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!force && club.lastReportedApiVersion === clientVersion) return;
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
