import { describe, it, expect, vi, beforeEach } from "vitest";

// One findMany mock serves the approval's read AND the two reads inside
// assignClubLodges's transaction, in that order.
const findMany = vi.fn();
const updateMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    otherLodge: { findMany: (...a: unknown[]) => findMany(...a) },
    $transaction: (fn: (t: unknown) => unknown) => fn({ otherLodge: { findMany, updateMany } }),
  },
}));

import { assignRequestedLodgesOnApproval } from "@/lib/club-lodges";

type Row = { id: string; name: string; sourceClubId: string | null; sourceClub: { name: string } | null };
const lodge = (id: string, name: string, owner: string | null = null, ownerName = "Other Club"): Row => ({
  id,
  name,
  sourceClubId: owner,
  sourceClub: owner ? { name: ownerName } : null,
});

describe("assignRequestedLodgesOnApproval (#40)", () => {
  beforeEach(() => {
    findMany.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 0 });
  });

  it("assigns the free requested lodges, skips one another club took meanwhile and one that no longer exists, and says why", async () => {
    findMany
      .mockResolvedValueOnce([lodge("a", "Alpha"), lodge("b", "Beta", "other-club", "Other Club")]) // the approval's read
      .mockResolvedValueOnce([lodge("a", "Alpha")]) // assignClubLodges: wanted
      .mockResolvedValueOnce([]); // assignClubLodges: currently owned
    updateMany.mockResolvedValue({ count: 1 });

    const outcome = await assignRequestedLodgesOnApproval("club-1", ["a", "b", "ghost", "a"]);

    expect(outcome.assigned).toEqual(["Alpha"]);
    expect(outcome.skipped).toEqual([
      { name: "Beta", reason: "owned", club: "Other Club" },
      { name: "ghost", reason: "missing" },
    ]);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a"] }, sourceClubId: null }, data: { sourceClubId: "club-1" } }),
    );
  });

  it("assigns nothing and touches nothing when every requested lodge is gone or taken", async () => {
    findMany.mockResolvedValueOnce([lodge("b", "Beta", "other-club")]);
    const outcome = await assignRequestedLodgesOnApproval("club-1", ["b", "ghost"]);
    expect(outcome).toEqual({
      assigned: [],
      skipped: [
        { name: "Beta", reason: "owned", club: "Other Club" },
        { name: "ghost", reason: "missing" },
      ],
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(await assignRequestedLodgesOnApproval("club-1", [])).toEqual({ assigned: [], skipped: [] });
  });

  it("reports a lodge claimed between the read and the write as changed, rather than failing the approval", async () => {
    findMany
      .mockResolvedValueOnce([lodge("a", "Alpha")])
      .mockResolvedValueOnce([lodge("a", "Alpha")])
      .mockResolvedValueOnce([]);
    updateMany.mockResolvedValue({ count: 0 }); // the status-guarded claim matched nothing

    const outcome = await assignRequestedLodgesOnApproval("club-1", ["a"]);
    expect(outcome).toEqual({ assigned: [], skipped: [{ name: "Alpha", reason: "changed" }] });
  });
});
