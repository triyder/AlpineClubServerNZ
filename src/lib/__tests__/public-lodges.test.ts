import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/db", () => ({ prisma: { otherLodge: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { loadPublicLodgeRecords } from "@/lib/public-lodges";

describe("loadPublicLodgeRecords (#16)", () => {
  it("never offers a deleted lodge to the public", async () => {
    await loadPublicLodgeRecords();
    expect(findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });
});
