import "server-only";
import type { Prisma } from "@prisma/client";
import {
  amenitiesDiffer,
  amenityCreateRows,
  type LodgeAmenity,
} from "@/lib/other-lodges";

/**
 * Make a lodge's stored amenities equal `incoming` (names already unique and
 * validated). Runs inside the caller's transaction so the lodge row and its
 * amenities change together or not at all.
 *
 * ORDER IS THE CALLER'S JOB: update the lodge row FIRST, in the same
 * transaction, and only then call this. The row update takes the row lock for
 * the rest of the transaction, so a second writer's replacement waits behind
 * the first's commit and then sees — and deletes — what it wrote. Done the
 * other way round, two overlapping writers interleave their deletes and
 * upserts and the lodge ends up with the UNION of both sets. The row update is
 * also what moves the lodge's `updatedAt`: the incremental pull is keyed on
 * the lodge row, so an amenity edit that left it untouched would never be
 * pulled by any club.
 *
 * Returns whether anything changed, judged against `existing` as the caller
 * read it before the transaction.
 */
export async function replaceAmenities(
  tx: Prisma.TransactionClient,
  lodgeId: string,
  incoming: ReadonlyArray<{ name: string; description?: string | null }>,
  existing: ReadonlyArray<LodgeAmenity>,
): Promise<boolean> {
  if (!amenitiesDiffer(existing, incoming)) return false;

  const rows = amenityCreateRows(incoming);
  await tx.amenity.deleteMany({
    where: { lodgeId, name: { notIn: rows.map((r) => r.name) } },
  });
  for (const row of rows) {
    await tx.amenity.upsert({
      where: { lodgeId_name: { lodgeId, name: row.name } },
      create: { lodgeId, ...row },
      update: { description: row.description },
    });
  }
  return true;
}
