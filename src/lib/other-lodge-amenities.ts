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
 * Returns whether anything changed. The CALLER must then move the lodge's own
 * `updatedAt`: the incremental pull is keyed on the lodge row, so an amenity
 * edit that left it untouched would never be pulled by any club.
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
