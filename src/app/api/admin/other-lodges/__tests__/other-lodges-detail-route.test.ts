import { describe, it, expect, vi, beforeEach } from "vitest";

const requireManager = vi.fn();
vi.mock("@/lib/admin-guard", () => ({
  requireManager: () => requireManager(),
}));

const create = vi.fn();
const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const update = vi.fn();
const amenityDeleteMany = vi.fn();
const amenityUpsert = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});

const tx = {
  otherLodge: {
    update: (...a: unknown[]) => update(...a),
    findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
  },
  amenity: {
    deleteMany: (...a: unknown[]) => amenityDeleteMany(...a),
    upsert: (...a: unknown[]) => amenityUpsert(...a),
  },
};
const transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));

vi.mock("@/lib/db", () => ({
  prisma: {
    otherLodge: {
      create: (...a: unknown[]) => create(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      // Every name, read for the lookalike check on create and rename.
      findMany: async () => [],
      update: (...a: unknown[]) => update(...a),
    },
    $transaction: (fn: (t: typeof tx) => unknown) => transaction(fn),
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "@/app/api/admin/other-lodges/route";
import { PATCH } from "@/app/api/admin/other-lodges/[id]/route";

const SESSION = { userId: "u1", email: "a@x.nz", role: "ADMIN" as const };

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  name: "Ruapehu Lodge",
  location: null,
  bookingOfficerName: null,
  bookingOfficerEmail: null,
  bookingOfficerPhone: null,
  bedCapacity: null,
  siteUrl: null,
  bookingPath: null,
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
  amenities: [] as Array<{ name: string; description: string | null }>,
  sourceClubId: null,
  sourceClub: null,
  lastUpdatedByClubId: null,
  lastUpdatedByClub: null,
  lastUploadedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

function jsonReq(body: unknown, method: string) {
  return new Request("https://s/api/admin/other-lodges", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: "l1" }) };

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(SESSION);
  create.mockReset();
  findUnique.mockReset();
  // The row re-read inside the transaction, after the amenities are replaced.
  findUniqueOrThrow.mockReset().mockResolvedValue(dbRow());
  update.mockReset();
  amenityDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  amenityUpsert.mockReset().mockResolvedValue({});
  transaction.mockClear();
  auditCreate.mockClear();
});

describe("POST /api/admin/other-lodges with the new fields", () => {
  it("creates the lodge with every detail column and its amenities in ONE write", async () => {
    create.mockResolvedValue(dbRow());
    const res = await POST(
      jsonReq(
        {
          name: "Ruapehu Lodge",
          siteUrl: " https://ruapehu.example ",
          bookingPath: "/book",
          requiresLodgeCustodian: true,
          freeWifi: true,
          cancellationPeriod: "14 days",
          winterSeasonStart: "2026-06-01",
          summerSeasonStart: "",
          amenities: [{ name: " Sauna ", description: "" }, { name: "Bike store", description: "Locked" }],
        },
        "POST",
      ),
    );
    expect(res.status).toBe(201);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      siteUrl: "https://ruapehu.example",
      bookingPath: "/book",
      requiresLodgeCustodian: true,
      freeWifi: true,
      cancellationPeriod: "14 days",
      summerSeasonStart: null,
    });
    expect(data.winterSeasonStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(data.amenities).toEqual({
      create: [
        { name: "Sauna", description: null },
        { name: "Bike store", description: "Locked" },
      ],
    });
  });

  it.each([
    ["a non-http site URL", { siteUrl: "javascript:alert(1)" }],
    ["an impossible date", { winterSeasonStart: "2026-02-30" }],
    ["duplicate amenity names", { amenities: [{ name: "a" }, { name: "A" }] }],
  ])("400 for %s, and writes nothing", async (_label, extra) => {
    const res = await POST(jsonReq({ name: "X", ...extra }, "POST"));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/other-lodges/:id with the new fields", () => {
  it("a partial update that names no detail field leaves every detail column alone", async () => {
    findUnique.mockResolvedValue(dbRow({ freeWifi: true }));
    update.mockResolvedValue(dbRow({ freeWifi: true, bedCapacity: 12 }));
    const res = await PATCH(jsonReq({ bedCapacity: 12 }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ bedCapacity: 12 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("changing ONLY the amenities replaces the set and moves the lodge's updatedAt", async () => {
    findUnique.mockResolvedValue(
      dbRow({ amenities: [{ name: "Old", description: null }] }),
    );
    update.mockResolvedValue({});
    findUniqueOrThrow.mockResolvedValue(
      dbRow({ amenities: [{ name: "Sauna", description: null }] }),
    );

    const res = await PATCH(jsonReq({ amenities: [{ name: "Sauna" }] }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    // The response is the row as re-read AFTER the replacement.
    expect((await res.json()).otherLodge.amenities).toEqual([{ name: "Sauna", description: null }]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(amenityDeleteMany).toHaveBeenCalledWith({
      where: { lodgeId: "l1", name: { notIn: ["Sauna"] } },
    });
    expect(amenityUpsert).toHaveBeenCalledWith({
      where: { lodgeId_name: { lodgeId: "l1", name: "Sauna" } },
      create: { lodgeId: "l1", name: "Sauna", description: null },
      update: { description: null },
    });
    // The pull is keyed on the lodge row: with no scalar change, updatedAt must
    // be moved by hand or no club would ever see this edit.
    const written = update.mock.calls[0][0].data;
    expect(written.updatedAt).toBeInstanceOf(Date);

    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.metadata.changedFields).toEqual(["amenities"]);
  });

  it("an amenity list identical to what is stored writes nothing", async () => {
    findUnique.mockResolvedValue(
      dbRow({ amenities: [{ name: "Sauna", description: "Wood" }] }),
    );
    findUniqueOrThrow.mockResolvedValue(dbRow());
    const res = await PATCH(
      jsonReq({ amenities: [{ name: "Sauna", description: "Wood" }] }, "PATCH"),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(amenityDeleteMany).not.toHaveBeenCalled();
    expect(amenityUpsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("an empty amenity list clears them all", async () => {
    findUnique.mockResolvedValue(dbRow({ amenities: [{ name: "Sauna", description: null }] }));
    update.mockResolvedValue(dbRow());
    await PATCH(jsonReq({ amenities: [] }, "PATCH"), ctx);
    expect(amenityDeleteMany).toHaveBeenCalledWith({
      where: { lodgeId: "l1", name: { notIn: [] } },
    });
    expect(amenityUpsert).not.toHaveBeenCalled();
  });

  it("scalars and amenities together share one transaction", async () => {
    findUnique.mockResolvedValue(dbRow());
    update.mockResolvedValue(dbRow());
    await PATCH(
      jsonReq({ freeWifi: true, amenities: [{ name: "Sauna" }] }, "PATCH"),
      ctx,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toMatchObject({ freeWifi: true });
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.metadata.changedFields).toEqual(["freeWifi", "amenities"]);
  });

  it("writes the lodge ROW before touching the amenities, so its lock serialises overlapping replacements", async () => {
    findUnique.mockResolvedValue(dbRow({ amenities: [{ name: "Old", description: null }] }));
    update.mockResolvedValue({});
    await PATCH(jsonReq({ amenities: [{ name: "Sauna" }] }, "PATCH"), ctx);
    const rowWrite = update.mock.invocationCallOrder[0];
    expect(rowWrite).toBeLessThan(amenityDeleteMany.mock.invocationCallOrder[0]);
    expect(rowWrite).toBeLessThan(amenityUpsert.mock.invocationCallOrder[0]);
    // And the row is re-read for the response only after both.
    expect(findUniqueOrThrow.mock.invocationCallOrder[0]).toBeGreaterThan(
      amenityUpsert.mock.invocationCallOrder[0],
    );
  });

  it("400 for an invalid site URL, and nothing is written", async () => {
    findUnique.mockResolvedValue(dbRow());
    const res = await PATCH(jsonReq({ siteUrl: "ftp://x" }, "PATCH"), ctx);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
