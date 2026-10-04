import { describe, it, expect, vi, beforeEach } from "vitest";

const requireManager = vi.fn();
vi.mock("@/lib/admin-guard", () => ({
  requireManager: () => requireManager(),
}));

const clubFindUnique = vi.fn();
const lodgeFindMany = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    club: { findUnique: (...a: unknown[]) => clubFindUnique(...a) },
    otherLodge: { findMany: (...a: unknown[]) => lodgeFindMany(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

const assign = vi.fn();
vi.mock("@/lib/club-lodges", () => ({
  assignClubLodges: (...a: unknown[]) => assign(...a),
}));

import { PUT } from "@/app/api/admin/clubs/[id]/lodges/route";

const SESSION = { userId: "u1", email: "a@x.nz", role: "MANAGER" as const };
const ctx = (id = "club_1") => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) =>
  new Request("https://s/api/admin/clubs/club_1/lodges", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(SESSION);
  clubFindUnique.mockReset().mockResolvedValue({ id: "club_1", status: "APPROVED" });
  lodgeFindMany.mockReset().mockResolvedValue([{ id: "a", name: "Alpha" }]);
  assign.mockReset().mockResolvedValue({ ok: true, added: ["Alpha"], removed: [] });
  auditCreate.mockClear();
});

describe("PUT /api/admin/clubs/:id/lodges", () => {
  it("401 for a caller who is not an admin or manager, and changes nothing", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    const res = await PUT(req({ lodgeIds: ["a"] }), ctx());
    expect(res.status).toBe(401);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ["no list", {}],
    ["a non-array", { lodgeIds: "a" }],
    ["a blank id", { lodgeIds: [""] }],
    ["an extra key", { lodgeIds: [], clubId: "other" }],
    ["too many ids", { lodgeIds: Array.from({ length: 501 }, (_, i) => `l${i}`) }],
  ])("400 for %s", async (_label, body) => {
    const res = await PUT(req(body), ctx());
    expect(res.status).toBe(400);
    expect(assign).not.toHaveBeenCalled();
  });

  it("404 for an unknown club", async () => {
    clubFindUnique.mockResolvedValue(null);
    const res = await PUT(req({ lodgeIds: ["a"] }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "REJECTED"])("409 for a %s club, which cannot sync", async (status) => {
    clubFindUnique.mockResolvedValue({ id: "club_1", status });
    const res = await PUT(req({ lodgeIds: ["a"] }), ctx());
    expect(res.status).toBe(409);
    expect(assign).not.toHaveBeenCalled();
  });

  it("assigns for the club in the PATH (not anything in the body), audits, and returns the owned list", async () => {
    const res = await PUT(req({ lodgeIds: ["a"] }), ctx());
    expect(res.status).toBe(200);
    expect(assign).toHaveBeenCalledWith("club_1", ["a"]);
    expect(await res.json()).toEqual({ lodges: [{ id: "a", name: "Alpha" }] });
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: "club.lodges.assign", clubId: "club_1", userId: "u1" });
    expect(audit.metadata).toEqual({ added: ["Alpha"], removed: [] });
  });

  it("accepts an empty list (gives every lodge back to central)", async () => {
    assign.mockResolvedValue({ ok: true, added: [], removed: ["Alpha"] });
    const res = await PUT(req({ lodgeIds: [] }), ctx());
    expect(res.status).toBe(200);
    expect(assign).toHaveBeenCalledWith("club_1", []);
  });

  it("400 when a chosen lodge no longer exists", async () => {
    assign.mockResolvedValue({ ok: false, reason: "missing", ids: ["ghost"] });
    const res = await PUT(req({ lodgeIds: ["ghost"] }), ctx());
    expect(res.status).toBe(400);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("409 naming the other club when a lodge is already assigned", async () => {
    assign.mockResolvedValue({
      ok: false,
      reason: "owned",
      lodges: [{ name: "Beta", club: "Tararua Club" }],
    });
    const res = await PUT(req({ lodgeIds: ["b"] }), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Beta (Tararua Club)");
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("409 when a lodge was assigned by someone else while saving", async () => {
    assign.mockResolvedValue({ ok: false, reason: "changed" });
    const res = await PUT(req({ lodgeIds: ["a"] }), ctx());
    expect(res.status).toBe(409);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
