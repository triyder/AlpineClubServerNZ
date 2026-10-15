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
