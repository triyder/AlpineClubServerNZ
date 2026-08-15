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
  distribute: false,
  sourceClubId: null,
  sourceClub: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(SESSION);
  create.mockReset();
  findMany.mockReset();
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
    findMany.mockResolvedValue([dbRow({ distribute: true })]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.otherLodges).toHaveLength(1);
    expect(json.otherLodges[0]).toMatchObject({
      name: "Ruapehu Lodge",
      distribute: true,
      sourceClub: null,
    });
    // Serialized dates are ISO strings.
    expect(typeof json.otherLodges[0].createdAt).toBe("string");
  });
});

describe("POST /api/admin/other-lodges", () => {
  it("creates a lodge (201) with normalized blanks", async () => {
    create.mockResolvedValue(dbRow({ name: "Tasman Lodge" }));
    const res = await POST(
      jsonReq({ name: "  Tasman Lodge  ", location: "   ", distribute: true }),
    );
    expect(res.status).toBe(201);
    const arg = create.mock.calls[0][0];
    expect(arg.data.name).toBe("Tasman Lodge");
    expect(arg.data.location).toBeNull(); // whitespace folded to null
    expect(arg.data.distribute).toBe(true);
    expect(auditCreate).toHaveBeenCalled();
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
});

describe("PATCH /api/admin/other-lodges/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns 404 for an unknown lodge", async () => {
    findUnique.mockResolvedValue(null);
    const res = await PATCH(jsonReq({ distribute: true }, "PATCH"), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("toggles distribution without clearing other fields", async () => {
    findUnique.mockResolvedValue(dbRow());
    update.mockResolvedValue(dbRow({ distribute: true }));
    const res = await PATCH(jsonReq({ distribute: true }, "PATCH"), ctx("l1"));
    expect(res.status).toBe(200);
    const arg = update.mock.calls[0][0];
    // Only `distribute` is in the update payload — a partial PATCH.
    expect(Object.keys(arg.data)).toEqual(["distribute"]);
    expect(arg.data.distribute).toBe(true);
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
