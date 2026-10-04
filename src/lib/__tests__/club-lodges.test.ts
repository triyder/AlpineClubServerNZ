import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const updateMany = vi.fn();
const transaction = vi.fn(async (fn: (t: unknown) => unknown) =>
  fn({ otherLodge: { findMany, updateMany } }),
);
vi.mock("@/lib/db", () => ({
  prisma: { $transaction: (fn: (t: unknown) => unknown) => transaction(fn) },
}));

import { assignClubLodges } from "@/lib/club-lodges";

type Row = {
  id: string;
  name: string;
  sourceClubId: string | null;
  sourceClub: { name: string } | null;
};
const lodge = (id: string, name: string, owner: string | null = null, ownerName = "Other Club"): Row => ({
  id,
  name,
  sourceClubId: owner,
  sourceClub: owner ? { name: ownerName } : null,
});

/** First findMany = the wanted lodges; second = what the club owns now. */
function setup(wanted: Row[], current: Array<{ id: string; name: string }>) {
  findMany.mockReset();
  findMany.mockResolvedValueOnce(wanted).mockResolvedValueOnce(current);
}

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 0 });
  transaction.mockClear();
});

describe("assignClubLodges", () => {
  it("claims unowned lodges for the club", async () => {
    setup([lodge("a", "Alpha"), lodge("b", "Beta")], []);
    updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await assignClubLodges("club_1", ["a", "b"]);

    expect(result).toEqual({ ok: true, added: ["Alpha", "Beta"], removed: [] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, sourceClubId: null },
      data: { sourceClubId: "club_1" },
    });
  });

  it("returns unticked lodges to central ownership, never deleting them", async () => {
    setup([lodge("a", "Alpha", "club_1")], [
      { id: "a", name: "Alpha" },
      { id: "z", name: "Zeta" },
    ]);

    const result = await assignClubLodges("club_1", ["a"]);

    expect(result).toEqual({ ok: true, added: [], removed: ["Zeta"] });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["z"] }, sourceClubId: "club_1" },
      data: { sourceClubId: null },
    });
  });

  it("an empty list gives every lodge back to central", async () => {
    setup([], [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
    const result = await assignClubLodges("club_1", []);
    expect(result).toEqual({ ok: true, added: [], removed: ["Alpha", "Beta"] });
    expect(updateMany.mock.calls[0][0].data).toEqual({ sourceClubId: null });
  });

  it("writes nothing when the list is unchanged", async () => {
    setup([lodge("a", "Alpha", "club_1")], [{ id: "a", name: "Alpha" }]);
    const result = await assignClubLodges("club_1", ["a"]);
    expect(result).toEqual({ ok: true, added: [], removed: [] });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("REFUSES a lodge owned by another club, naming both, and changes nothing", async () => {
    setup([lodge("a", "Alpha"), lodge("b", "Beta", "club_2", "Tararua Club")], [
      { id: "z", name: "Zeta" },
    ]);

    const result = await assignClubLodges("club_1", ["a", "b"]);

    expect(result).toEqual({
      ok: false,
      reason: "owned",
      lodges: [{ name: "Beta", club: "Tararua Club" }],
    });
    // Nothing was written — not even the unrelated claim of Alpha or removal of Zeta.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("REFUSES a lodge that no longer exists, and changes nothing", async () => {
    setup([lodge("a", "Alpha")], []);
    const result = await assignClubLodges("club_1", ["a", "ghost"]);
    expect(result).toEqual({ ok: false, reason: "missing", ids: ["ghost"] });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rolls back when another request claimed a lodge between the check and the write", async () => {
    setup([lodge("a", "Alpha"), lodge("b", "Beta")], []);
    updateMany.mockResolvedValueOnce({ count: 1 }); // one of two was taken meanwhile

    const result = await assignClubLodges("club_1", ["a", "b"]);

    expect(result).toEqual({ ok: false, reason: "changed" });
  });

  it("treats a repeated id once", async () => {
    setup([lodge("a", "Alpha")], []);
    updateMany.mockResolvedValueOnce({ count: 1 });
    await assignClubLodges("club_1", ["a", "a", "a"]);
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a"] } });
    expect(updateMany.mock.calls[0][0].where.id).toEqual({ in: ["a"] });
  });

  it("runs the checks and the writes in one transaction", async () => {
    setup([lodge("a", "Alpha")], []);
    updateMany.mockResolvedValueOnce({ count: 1 });
    await assignClubLodges("club_1", ["a"]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
