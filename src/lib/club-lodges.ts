import "server-only";
import { prisma } from "@/lib/db";

/**
 * Assign lodges to a club (`/clubs`): make the set of lodges the club owns equal
 * `lodgeIds`.
 *
 * Ownership is the existing `OtherLodge.sourceClubId`, which already decides
 * whose upload may update a lodge — so there is one source of truth and the
 * upload rule needs no second lookup. A lodge with no owner is "central".
 *
 * Rules, all enforced here and not left to the form:
 * - a lodge owned by ANOTHER club cannot be taken (the form greys it out; this is
 *   what makes a hand-built request unable to do it either);
 * - unticking returns a lodge to central ownership, it does not delete it;
 * - the whole request is all-or-nothing, including when another request claims a
 *   lodge between the check and the write.
 */

export type AssignClubLodgesResult =
  | { ok: true; added: string[]; removed: string[] }
  | { ok: false; reason: "missing"; ids: string[] }
  | { ok: false; reason: "owned"; lodges: Array<{ name: string; club: string | null }> }
  | { ok: false; reason: "changed" };

/** Thrown inside the transaction to roll it back when a lodge was claimed meanwhile. */
class OwnershipChangedError extends Error {}

export async function assignClubLodges(
  clubId: string,
  lodgeIds: string[],
): Promise<AssignClubLodgesResult> {
  const wantedIds = [...new Set(lodgeIds)];

  try {
    return await prisma.$transaction(async (tx) => {
      const wanted = await tx.otherLodge.findMany({
        where: { id: { in: wantedIds } },
        select: {
          id: true,
          name: true,
          sourceClubId: true,
          sourceClub: { select: { name: true } },
        },
      });

      const found = new Set(wanted.map((l) => l.id));
      const missing = wantedIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        return { ok: false as const, reason: "missing" as const, ids: missing };
      }

      const taken = wanted.filter(
        (l) => l.sourceClubId !== null && l.sourceClubId !== clubId,
      );
      if (taken.length > 0) {
        return {
          ok: false as const,
          reason: "owned" as const,
          lodges: taken.map((l) => ({ name: l.name, club: l.sourceClub?.name ?? null })),
        };
      }

      const current = await tx.otherLodge.findMany({
        where: { sourceClubId: clubId },
        select: { id: true, name: true },
      });
      const toRemove = current.filter((l) => !wantedIds.includes(l.id));
      const toAdd = wanted.filter((l) => l.sourceClubId !== clubId);

      if (toRemove.length > 0) {
        await tx.otherLodge.updateMany({
          where: { id: { in: toRemove.map((l) => l.id) }, sourceClubId: clubId },
          data: { sourceClubId: null },
        });
      }
      if (toAdd.length > 0) {
        // Status-guarded claim: only lodges that are STILL unowned are taken. If
        // another request got one first the counts differ and everything rolls back.
        const claimed = await tx.otherLodge.updateMany({
          where: { id: { in: toAdd.map((l) => l.id) }, sourceClubId: null },
          data: { sourceClubId: clubId },
        });
        if (claimed.count !== toAdd.length) throw new OwnershipChangedError();
      }

      return {
        ok: true as const,
        added: toAdd.map((l) => l.name).sort((a, b) => a.localeCompare(b)),
        removed: toRemove.map((l) => l.name).sort((a, b) => a.localeCompare(b)),
      };
    });
  } catch (error) {
    if (error instanceof OwnershipChangedError) {
      return { ok: false, reason: "changed" };
    }
    throw error;
  }
}
