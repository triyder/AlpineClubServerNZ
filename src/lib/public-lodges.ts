import { prisma } from "@/lib/db";
import { publicLodgeSelect } from "@/lib/lodge-search";
import { liveOtherLodgeWhere, otherLodgeOrderBy } from "@/lib/other-lodges";

/**
 * Every lodge the public lodge search (`/book`) may offer: the whole registry
 * except lodges an admin deleted (#16), in the registry's name order.
 */
export function loadPublicLodgeRecords() {
  return prisma.otherLodge.findMany({
    where: liveOtherLodgeWhere,
    select: publicLodgeSelect,
    orderBy: otherLodgeOrderBy(),
  });
}

/**
 * Which of `ids` give a booking officer's email (#25, the bed planner's third
 * group): their ids ONLY. The address is filtered on in the database and never
 * read out, so the public search stays free of it (`publicLodgeSelect` does
 * not select it).
 */
export async function loadLodgeIdsWithEmail(ids: ReadonlyArray<string>): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.otherLodge.findMany({
    where: {
      id: { in: [...ids] },
      AND: [{ bookingOfficerEmail: { not: null } }, { NOT: { bookingOfficerEmail: "" } }],
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
