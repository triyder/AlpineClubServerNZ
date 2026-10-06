import { describe, it, expect, vi, beforeEach } from "vitest";

const requireManager = vi.fn();
vi.mock("@/lib/admin-guard", () => ({
  requireManager: () => requireManager(),
}));

const create = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const del = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    otherLodge: {
      create: (...a: unknown[]) => create(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => del(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "@/app/api/admin/other-lodges/route";
import { PATCH, DELETE } from "@/app/api/admin/other-lodges/[id]/route";

const SESSION = { userId: "u1", email: "a@x.nz", role: "ADMIN" as const };

function jsonReq(body: unknown, method = "POST") {
  return new Request("https://s/api/admin/other-lodges", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  name: "Ruapehu Lodge",
  location: null,
  bookingOfficerName: null,
  bookingOfficerEmail: null,
  bookingOfficerPhone: null,
  bedCapacity: null,
  siteUrl: null,
  doubleBeds: null,
  singleBeds: null,
  minutesWalkToLodge: null,
  roomType: null,
  skiWorkshopArea: false,
  gamesRoom: false,
  requiresLodgeCustodian: false,
  freeWifi: false,
  quietRoom: false,
  dryingRoom: false,
  sharedKitchen: false,
  wheelchairAccessible: false,
  breakfastIncluded: false,
  lunchIncluded: false,
  dinnerIncluded: false,
  cancellationPeriod: null,
  winterSeasonStart: null,
  summerSeasonStart: null,
  amenities: [],
  sourceClubId: null,
  sourceClub: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(SESSION);
  create.mockReset();
  // Every name, read for the lookalike check; the GET tests override this.
  findMany.mockReset().mockResolvedValue([]);
  findUnique.mockReset();
  update.mockReset();
  del.mockReset();
  auditCreate.mockClear();
});

describe("GET /api/admin/other-lodges", () => {
  it("returns 401 when not a manager", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists serialized lodges", async () => {
    findMany.mockResolvedValue([dbRow()]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.otherLodges).toHaveLength(1);
    expect(json.otherLodges[0]).toMatchObject({
      name: "Ruapehu Lodge",
      sourceClub: null,
    });
    // The per-row distribute marker is gone: every lodge is distributed.
    expect(json.otherLodges[0]).not.toHaveProperty("distribute");
    // Serialized dates are ISO strings.
    expect(typeof json.otherLodges[0].createdAt).toBe("string");
  });
});

describe("POST /api/admin/other-lodges", () => {
  it("creates a lodge (201) with normalized blanks", async () => {
    create.mockResolvedValue(dbRow({ name: "Tasman Lodge" }));
    const res = await POST(
      jsonReq({ name: "  Tasman Lodge  ", location: "   " }),
    );
    expect(res.status).toBe(201);
    const arg = create.mock.calls[0][0];
    expect(arg.data.name).toBe("Tasman Lodge");
    expect(arg.data.location).toBeNull(); // whitespace folded to null
    expect(arg.data).not.toHaveProperty("distribute");
    expect(auditCreate).toHaveBeenCalled();
  });

  it("rejects the removed distribute field (400)", async () => {
    const res = await POST(jsonReq({ name: "Tasman Lodge", distribute: true }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a missing name (400)", async () => {
    const res = await POST(jsonReq({ location: "somewhere" }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an invalid email (400)", async () => {
    const res = await POST(jsonReq({ name: "X", bookingOfficerEmail: "nope" }));
    expect(res.status).toBe(400);
  });

  it("maps a duplicate name to 409", async () => {
    const { Prisma } = await import("@prisma/client");
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "7",
      }),
    );
    const res = await POST(jsonReq({ name: "Ruapehu Lodge" }));
    expect(res.status).toBe(409);
  });

  it.each([
    ["a zero-width space", "Ruapehu​ Lodge"],
    ["a no-break space", "Ruapehu Lodge"],
    ["full-width characters", "Ｒuapehu Lodge"],
    ["a different case", "ruapehu lodge"],
  ])("409 for a name that differs from an existing one only by %s, creating nothing", async (_l, name) => {
    findMany.mockResolvedValue([{ name: "Ruapehu Lodge" }, { name: "Tasman Lodge" }]);
    const res = await POST(jsonReq({ name }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Ruapehu Lodge");
    expect(create).not.toHaveBeenCalled();
  });

  it("a genuinely different name is created", async () => {
    findMany.mockResolvedValue([{ name: "Ruapehu Lodge" }]);
    create.mockResolvedValue(dbRow({ name: "Ruapehu Lodge 2" }));
    const res = await POST(jsonReq({ name: "Ruapehu Lodge 2" }));
    expect(res.status).toBe(201);
  });

  it("400 for a control character in the name, creating nothing", async () => {
    const res = await POST(jsonReq({ name: "Ruapehu\u0000 Lodge" }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/other-lodges/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 404 for an unknown lodge", async () => {
    findUnique.mockResolvedValue(null);
    const res = await PATCH(jsonReq({ bedCapacity: 5 }, "PATCH"), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("updates only the fields sent, without clearing the others", async () => {
    findUnique.mockResolvedValue(dbRow());
    update.mockResolvedValue(dbRow({ bedCapacity: 12 }));
    const res = await PATCH(jsonReq({ bedCapacity: 12 }, "PATCH"), ctx("l1"));
    expect(res.status).toBe(200);
    const arg = update.mock.calls[0][0];
    // Only `bedCapacity` is in the update payload — a partial PATCH.
    expect(Object.keys(arg.data).sort()).toEqual([
      "bedCapacity",
      "lastUpdatedByClub",
      "lastUploadedAt",
    ]);
    expect(arg.data.bedCapacity).toBe(12);
    // An admin edit takes over the "updated by" credit from any club.
    expect(arg.data.lastUpdatedByClub).toEqual({ disconnect: true });
    expect(arg.data.lastUploadedAt).toBeNull();
  });

  it("rejects the removed distribute field (400)", async () => {
    findUnique.mockResolvedValue(dbRow());
    const res = await PATCH(jsonReq({ distribute: true }, "PATCH"), ctx("l1"));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("409 for a rename that only looks like ANOTHER lodge's name, writing nothing", async () => {
    findUnique.mockResolvedValue(dbRow());
    findMany.mockResolvedValue([{ name: "Tasman Lodge" }]);
    const res = await PATCH(jsonReq({ name: "tasman​ lodge" }, "PATCH"), ctx("l1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Tasman Lodge");
    // The lodge's own current name is excluded from the comparison.
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { not: "l1" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("a rename that changes only the case of its OWN name is allowed", async () => {
    findUnique.mockResolvedValue(dbRow());
    findMany.mockResolvedValue([{ name: "Tasman Lodge" }]);
    update.mockResolvedValue(dbRow({ name: "RUAPEHU Lodge" }));
    const res = await PATCH(jsonReq({ name: "RUAPEHU Lodge" }, "PATCH"), ctx("l1"));
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toMatchObject({ name: "RUAPEHU Lodge" });
  });

  it("sending the unchanged name does not read the other names at all", async () => {
    findUnique.mockResolvedValue(dbRow());
    update.mockResolvedValue(dbRow());
    await PATCH(jsonReq({ name: "Ruapehu Lodge", bedCapacity: 3 }, "PATCH"), ctx("l1"));
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/other-lodges/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 404 for an unknown lodge", async () => {
    findUnique.mockResolvedValue(null);
    const res = await DELETE(jsonReq({}, "DELETE"), ctx("nope"));
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes an existing lodge and audits it", async () => {
    findUnique.mockResolvedValue(dbRow());
    del.mockResolvedValue(dbRow());
    const res = await DELETE(jsonReq({}, "DELETE"), ctx("l1"));
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalled();
  });
});
