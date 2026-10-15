import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const authenticate = vi.fn();
vi.mock("@/lib/api-auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    authenticateApiRequest: (...a: unknown[]) => authenticate(...a),
  };
});

const findMany = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const amenityDeleteMany = vi.fn();
const amenityUpsert = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});

const tx = {
  otherLodge: { update: (...a: unknown[]) => update(...a) },
  amenity: {
    deleteMany: (...a: unknown[]) => amenityDeleteMany(...a),
    upsert: (...a: unknown[]) => amenityUpsert(...a),
  },
};
const transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));

/**
 * An upload item without an id (#69) reads the club's OWN lodges of that name
 * with `findMany`. Answered from the `findUnique` mock, which the tests set to
 * the stored row, so each test states the one stored lodge either way.
 */
let ownRows: unknown[] | null = null; // set to state several of the club's own lodges
async function ownByName(args: { where: { name: string; sourceClubId: string } }) {
  if (ownRows) return ownRows;
  const row = (await findUnique(args)) as { sourceClubId?: string | null } | null;
  return row && row.sourceClubId === args.where.sourceClubId ? [row] : [];
}
const isOwnByName = (args: unknown) => {
  const where = (args as { where?: Record<string, unknown> } | undefined)?.where;
  return !!where && "name" in where && "sourceClubId" in where;
};
vi.mock("@/lib/db", () => ({
  prisma: {
    otherLodge: {
      findMany: (...a: unknown[]) =>
        isOwnByName(a[0]) ? ownByName(a[0] as Parameters<typeof ownByName>[0]) : findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    $transaction: (fn: (t: typeof tx) => unknown) => transaction(fn),
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "@/app/api/v1/other-lodges/route";
import { parseLodgeDate } from "@/lib/other-lodges";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED", lastReportedApiVersion: null };
const authOk = (scopes: string[]) => ({
  ok: true,
  client: { club: CLUB, token: { id: "tok_1", scopes } },
});

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  name: "Whakapapa Lodge",
  location: null,
  bookingOfficerName: null,
  bookingOfficerEmail: null,
  bookingOfficerPhone: null,
  bedCapacity: 24,
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
  winterSeasonEnd: null,
  summerSeasonStart: null,
  summerSeasonEnd: null,
  amenities: [] as Array<{ name: string; description: string | null }>,
  sourceClubId: "club_1",
  sourceClub: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  ...over,
});

function req(method: string, body?: unknown) {
  return new Request("https://s/api/v1/other-lodges", {
    method,
    headers: { authorization: "Bearer acs_x_y", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue(authOk(["lodges:write", "lodges:read"]));
  // The pull's queries; GET tests override.
  findMany.mockReset().mockResolvedValue([]);
  findUnique.mockReset();
  ownRows = null;
  create.mockReset().mockResolvedValue({ id: "new_1" });
  update.mockReset().mockResolvedValue({});
  amenityDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  amenityUpsert.mockReset().mockResolvedValue({});
  transaction.mockClear();
  auditCreate.mockClear();
  resetRateLimits();
});

describe("POST /api/v1/other-lodges (upload) with the new fields", () => {
  it("creates a new lodge with its detail columns and amenities in one write", async () => {
    findUnique.mockResolvedValue(null);
    const res = await POST(
      req("POST", {
        lodges: [
          {
            name: "Whakapapa Lodge",
            freeWifi: true,
            siteUrl: "https://w.example",
            winterSeasonStart: "2026-06-01",
            amenities: [{ name: "Sauna", description: "Wood fired" }],
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ freeWifi: true, siteUrl: "https://w.example" });
    expect(data.winterSeasonStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(data.amenities).toEqual({ create: [{ name: "Sauna", description: "Wood fired" }] });
  });

  it("an identical re-upload (dates, booleans, amenities) is 'unchanged' and writes nothing", async () => {
    findUnique.mockResolvedValue(
      dbRow({
        freeWifi: true,
        winterSeasonStart: parseLodgeDate("2026-06-01"),
        amenities: [{ name: "Sauna", description: "Wood fired" }],
      }),
    );
    const res = await POST(
      req("POST", {
        lodges: [
          {
            name: "Whakapapa Lodge",
            freeWifi: true,
            winterSeasonStart: "2026-06-01",
            amenities: [{ name: "Sauna", description: "Wood fired" }],
          },
        ],
      }),
    );
    const body = await res.json();
    expect(body).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("a changed date is an update", async () => {
    findUnique.mockResolvedValue(
      dbRow({ winterSeasonStart: parseLodgeDate("2026-06-01") }),
    );
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", winterSeasonStart: "2026-06-08" }] }),
    );
    expect((await res.json()).updated).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("fields the upload does not mention are left alone (an older club's upload)", async () => {
    findUnique.mockResolvedValue(dbRow({ freeWifi: true, amenities: [{ name: "Sauna", description: null }] }));
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", bedCapacity: 30 }] }),
    );
    expect((await res.json()).updated).toBe(1);
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("freeWifi");
    expect(data).not.toHaveProperty("amenities");
    expect(data.bedCapacity).toBe(30);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("an amenities-only change updates the lodge, replaces the set, and moves updatedAt", async () => {
    findUnique.mockResolvedValue(dbRow({ amenities: [{ name: "Old", description: null }] }));
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", amenities: [{ name: "Sauna" }] }] }),
    );
    expect((await res.json()).updated).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(amenityDeleteMany).toHaveBeenCalledWith({
      where: { lodgeId: "l1", name: { notIn: ["Sauna"] } },
    });
    expect(amenityUpsert).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.updatedAt).toBeInstanceOf(Date);
    expect(data).toMatchObject({ lastUpdatedByClubId: "club_1" });
  });

  it("an upload may clear all amenities with an empty list", async () => {
    findUnique.mockResolvedValue(dbRow({ amenities: [{ name: "Sauna", description: null }] }));
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", amenities: [] }] }),
    );
    expect((await res.json()).updated).toBe(1);
    expect(amenityDeleteMany).toHaveBeenCalledWith({ where: { lodgeId: "l1", name: { notIn: [] } } });
  });

  it("another club's lodge, quoted by id, is still skipped, and none of its details are touched", async () => {
    findUnique.mockResolvedValue(dbRow({ sourceClubId: "club_other" }));
    const res = await POST(
      req("POST", {
        lodges: [{ id: "l1", name: "Whakapapa Lodge", freeWifi: true, amenities: [{ name: "x" }] }],
      }),
    );
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.results[0]).toMatchObject({ status: "skipped", reason: "owned-by-other-club" });
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("400 for invalid new-field values, writing nothing", async () => {
    for (const bad of [
      { siteUrl: "javascript:alert(1)" },
      { siteUrl: "https://club.nz@evil.com" },
      { siteUrl: "http:\\\\evil.com" },
      { winterSeasonStart: "2026-02-30" },
      { amenities: [{ name: "a" }, { name: "a" }] },
      { freeWifi: "yes" },
    ]) {
      const res = await POST(req("POST", { lodges: [{ name: "X", ...bad }] }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("writes the lodge ROW before touching the amenities, so its lock serialises overlapping replacements", async () => {
    findUnique.mockResolvedValue(dbRow({ amenities: [{ name: "Old", description: null }] }));
    await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", amenities: [{ name: "Sauna" }] }] }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    const rowWrite = update.mock.invocationCallOrder[0];
    expect(rowWrite).toBeLessThan(amenityDeleteMany.mock.invocationCallOrder[0]);
    expect(rowWrite).toBeLessThan(amenityUpsert.mock.invocationCallOrder[0]);
  });

  it("a control character anywhere in the payload makes the WHOLE upload a 400 before any write", async () => {
    findUnique.mockResolvedValue(null);
    const res = await POST(
      req("POST", {
        lodges: [
          { name: "Fine Lodge", location: "Here" },
          { name: "Bad\u0000 Lodge" },
          { name: "Also Fine", cancellationPeriod: "ok" },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("still writes the upload audit row, with the counts so far, when a later item fails", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValueOnce({ id: "new_1" }).mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      POST(req("POST", { lodges: [{ name: "One" }, { name: "Two" }, { name: "Three" }] })),
    ).rejects.toThrow("connection lost");
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe("otherLodge.upload");
    expect(audit.metadata).toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      renamed: 0,
      // What it created so far, by id (#69: names may repeat).
      createdLodges: [{ id: "new_1", name: "One" }],
      renamedLodges: [],
      total: 3,
      completed: false,
    });
  });

  it("the audit row of a finished upload says so", async () => {
    findUnique.mockResolvedValue(null);
    await POST(req("POST", { lodges: [{ name: "One" }] }));
    expect(auditCreate.mock.calls[0][0].data.metadata).toMatchObject({ created: 1, total: 1, completed: true });
  });
});

describe("POST /api/v1/other-lodges (upload): two lodges may share a name (#69, API 2.5)", () => {
  it.each([
    ["the same name", "Whakapapa Lodge"],
    ["a zero-width space", "Whakapapa\u200B Lodge"],
    ["a different case", "whakapapa lodge"],
  ])("creates a lodge whose name matches another club's by %s, and returns its id", async (_l, name) => {
    findUnique.mockResolvedValue(dbRow({ sourceClubId: "club_other" }));
    const res = await POST(req("POST", { lodges: [{ name }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 1, skipped: 0 });
    expect(body.results[0]).toEqual({ id: "new_1", name, status: "created" });
    expect(create.mock.calls[0][0].data).toMatchObject({ name, sourceClubId: "club_1" });
    expect(update).not.toHaveBeenCalled();
  });

  it("looks only at the club's OWN lodges of exactly that name", async () => {
    findUnique.mockResolvedValue(null);
    await POST(req("POST", { lodges: [{ name: "Kea Lodge" }] }));
    expect(findUnique.mock.calls[0][0].where).toEqual({ name: "Kea Lodge", sourceClubId: "club_1" });
  });

  it("skips, never creates, when the club owns two live lodges of that name (it cannot tell which)", async () => {
    ownRows = [dbRow({ id: "l1" }), dbRow({ id: "l2" })];
    const body = await (
      await POST(req("POST", { lodges: [{ name: "Whakapapa Lodge", bedCapacity: 99 }] }))
    ).json();
    expect(body).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(body.results[0]).toEqual({ name: "Whakapapa Lodge", status: "skipped", reason: "ambiguous-name" });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the one live lodge when the club also has a deleted one of that name", async () => {
    ownRows = [dbRow({ id: "l1", deletedAt: new Date() }), dbRow({ id: "l2", deletedAt: null })];
    const body = await (
      await POST(req("POST", { lodges: [{ name: "Whakapapa Lodge", bedCapacity: 99 }] }))
    ).json();
    expect(body.results[0]).toEqual({ id: "l2", name: "Whakapapa Lodge", status: "updated" });
    expect(update.mock.calls[0][0].where).toEqual({ id: "l2", deletedAt: null });
    expect(create).not.toHaveBeenCalled();
  });

  it("never re-creates the club's own deleted lodge from an upload that names it", async () => {
    ownRows = [dbRow({ id: "l1", deletedAt: new Date() })];
    const body = await (await POST(req("POST", { lodges: [{ name: "Whakapapa Lodge" }] }))).json();
    expect(body.results[0]).toEqual({
      id: "l1",
      name: "Whakapapa Lodge",
      status: "skipped",
      reason: "deleted",
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("two items of the same new name in one upload are two lodges", async () => {
    findUnique.mockResolvedValue(null);
    const body = await (
      await POST(req("POST", { lodges: [{ name: "Kea Lodge" }, { name: "Kea Lodge" }] }))
    ).json();
    expect(body).toMatchObject({ created: 2, skipped: 0 });
  });

  it("never reads every stored name: an upload has no lookalike check", async () => {
    findUnique.mockResolvedValue(null);
    await POST(req("POST", { lodges: [{ name: "New One" }, { name: "New Two" }] }));
    expect(findMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/v1/other-lodges (pull) with the new fields", () => {
  it("returns the new fields and amenities, with dates as YYYY-MM-DD", async () => {
    findMany.mockResolvedValue([
      dbRow({
        siteUrl: "https://w.example",
        quietRoom: true,
        winterSeasonStart: parseLodgeDate("2026-06-01"),
        amenities: [{ name: "Sauna", description: null }],
      }),
    ]);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const [lodge] = (await res.json()).lodges;
    expect(lodge).toMatchObject({
      siteUrl: "https://w.example",
      quietRoom: true,
      freeWifi: false,
      winterSeasonStart: "2026-06-01",
      summerSeasonStart: null,
      amenities: [{ name: "Sauna", description: null }],
    });
    // Never leaks provenance.
    expect(lodge).not.toHaveProperty("sourceClub");
  });
});

describe("GET /api/v1/other-lodges (pull) tells the club which lodges it owns", () => {
  /** Answers the two queries the route makes: the lodges, and the club's own. */
  function answer(lodges: unknown[], owned: Array<{ id: string; name: string }>) {
    findMany.mockImplementation(async (args: { where?: { sourceClubId?: string } }) =>
      args.where?.sourceClubId !== undefined ? owned : lodges,
    );
  }
  const ownedQuery = () =>
    findMany.mock.calls
      .map((c) => c[0] as { where?: { sourceClubId?: string } })
      .find((a) => a.where?.sourceClubId !== undefined);

  it("returns exactly the lodges the authenticated club owns, and no name-only list (2.5)", async () => {
    answer([dbRow()], [{ id: "la", name: "Alpha Lodge" }, { id: "lb", name: "Beta Lodge" }]);
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownLodges.map((l: { id: string }) => l.id)).toEqual(["la", "lb"]);
    expect(body).not.toHaveProperty("ownLodgeNames");
    expect(ownedQuery()?.where).toEqual({ sourceClubId: "club_1", deletedAt: null });
  });

  it("returns an empty list for a club that owns nothing", async () => {
    answer([dbRow()], []);
    const body = await (await GET(req("GET"))).json();
    expect(body.ownLodges).toEqual([]);
  });

  it("returns each owned lodge's permanent id beside its name (API 2.2), from the same query", async () => {
    answer([dbRow()], [{ id: "la", name: "Alpha Lodge" }, { id: "lb", name: "Beta Lodge" }]);
    const body = await (await GET(req("GET"))).json();
    expect(body.ownLodges).toEqual([
      { id: "la", name: "Alpha Lodge" },
      { id: "lb", name: "Beta Lodge" },
    ]);
    // Only the two fields: the envelope is not a second copy of the lodge.
    expect(ownedQuery()).toMatchObject({ select: { id: true, name: true } });
  });

  it("returns the whole list on an INCREMENTAL pull too (it is not a delta)", async () => {
    answer([], [{ id: "la", name: "Alpha Lodge" }]);
    const res = await GET(
      new Request("https://s/api/v1/other-lodges?since=2026-02-01T00:00:00.000Z", {
        method: "GET",
        headers: { authorization: "Bearer acs_x_y" },
      }),
    );
    const body = await res.json();
    expect(body.lodges).toEqual([]);
    expect(body.ownLodges).toEqual([{ id: "la", name: "Alpha Lodge" }]);
    // The owned query is not narrowed by `since`.
    expect(ownedQuery()?.where).toEqual({ sourceClubId: "club_1", deletedAt: null });
  });

  it("takes the club from the token, never from the request", async () => {
    answer([dbRow()], [{ id: "la", name: "Alpha Lodge" }]);
    await GET(
      new Request("https://s/api/v1/other-lodges?clubId=club_other&sourceClubId=club_other", {
        method: "GET",
        headers: { authorization: "Bearer acs_x_y" },
      }),
    );
    expect(ownedQuery()?.where).toEqual({ sourceClubId: "club_1", deletedAt: null });
  });

  it("keeps the envelope's existing fields", async () => {
    answer([dbRow()], []);
    const body = await (await GET(req("GET"))).json();
    expect(Object.keys(body).sort()).toEqual([
      "count",
      "cursor",
      "deletedLodges",
      "lodges",
      "ownLodges",
    ]);
    expect(body.count).toBe(1);
  });
});

describe("GET /api/v1/other-lodges (pull) does not hand out booking officer phone numbers (#11)", () => {
  it("leaves a stored phone number out of the response entirely", async () => {
    findMany.mockImplementation(async (args: { where?: { sourceClubId?: string } }) =>
      args.where?.sourceClubId !== undefined
        ? []
        : [dbRow({ bookingOfficerName: "Sam", bookingOfficerPhone: "021 555 0100" })],
    );
    const res = await GET(req("GET"));
    const text = await res.text();
    expect(text).not.toContain("021 555 0100");
    expect(text).not.toContain("bookingOfficerPhone");
    // The rest of the officer's details still go out.
    expect(JSON.parse(text).lodges[0].bookingOfficerName).toBe("Sam");
  });
});

describe("POST /api/v1/other-lodges (upload) updates only the club's own lodges", () => {
  it("skips a lodge owned centrally (no owner), quoted by id, changing nothing", async () => {
    findUnique.mockResolvedValue(dbRow({ sourceClubId: null }));
    const res = await POST(
      req("POST", { lodges: [{ id: "l1", name: "Whakapapa Lodge", bedCapacity: 99 }] }),
    );
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.results[0]).toMatchObject({ status: "skipped", reason: "owned-centrally" });
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("updates a lodge the club owns", async () => {
    findUnique.mockResolvedValue(dbRow({ sourceClubId: "club_1" }));
    const res = await POST(req("POST", { lodges: [{ name: "Whakapapa Lodge", bedCapacity: 99 }] }));
    expect((await res.json()).updated).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("non-member rates on the club upload and pull (API 2.2)", () => {
  it("an upload creates a lodge with its rates as two-place text", async () => {
    findUnique.mockResolvedValue(null);
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", winterRateAdult: 45.5, summerRateUnder5: 0 }] }),
    );
    expect((await res.json()).created).toBe(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      winterRateAdult: "45.50",
      summerRateUnder5: "0.00",
    });
  });

  it("re-uploading the stored rates is 'unchanged' and writes nothing", async () => {
    findUnique.mockResolvedValue(dbRow({ winterRateAdult: new Prisma.Decimal("45.50") }));
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", winterRateAdult: 45.5 }] }),
    );
    expect(await res.json()).toMatchObject({ updated: 0, unchanged: 1 });
    expect(update).not.toHaveBeenCalled();
  });

  it("a changed or cleared rate is an update", async () => {
    findUnique.mockResolvedValue(dbRow({ winterRateAdult: new Prisma.Decimal("45.50") }));
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", winterRateAdult: null }] }),
    );
    expect((await res.json()).updated).toBe(1);
    expect(update.mock.calls[0][0].data.winterRateAdult).toBeNull();
  });

  it("an upload that does not mention rates leaves them alone (a 2.1-shaped item)", async () => {
    findUnique.mockResolvedValue(dbRow({ winterRateAdult: new Prisma.Decimal("45.50") }));
    await POST(req("POST", { lodges: [{ name: "Whakapapa Lodge", bedCapacity: 30 }] }));
    expect(update.mock.calls[0][0].data).not.toHaveProperty("winterRateAdult");
  });

  it("400 for a rate that is not dollars and cents, writing nothing", async () => {
    const res = await POST(
      req("POST", { lodges: [{ name: "Whakapapa Lodge", winterRateAdult: 45.555 }] }),
    );
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("the pull returns every rate as dollars, null when not set", async () => {
    findMany
      .mockResolvedValueOnce([
        dbRow({
          winterRateAdult: new Prisma.Decimal("45.50"),
          summerRate5To11: new Prisma.Decimal("20.00"),
          winterRateUnder5: null,
        }),
      ])
      .mockResolvedValueOnce([]);
    const res = await GET(req("GET"));
    const lodge = (await res.json()).lodges[0];
    expect(lodge).toMatchObject({ winterRateAdult: 45.5, summerRate5To11: 20, winterRateUnder5: null });
  });
});

describe("POST /api/v1/other-lodges (upload) keyed by the lodge's id renames it (API 2.3)", () => {
  // findUnique is asked by id; an item without one reads the club's own
  // lodges of that name. Route each call by its `where`.
  function rows(byId: unknown, byName: unknown = null) {
    findUnique.mockImplementation(async (args: { where: { id?: string; name?: string } }) =>
      args.where.id !== undefined ? byId : byName,
    );
  }

  it("looks the lodge up by id, not by name, when the item carries one", async () => {
    rows(dbRow());
    await POST(req("POST", { lodges: [{ id: "l1", name: "Whakapapa Lodge" }] }));
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: "l1" });
  });

  it("renames the club's own lodge in place, moving updatedAt so every club's next pull carries it", async () => {
    rows(dbRow());
    const res = await POST(req("POST", { lodges: [{ id: "l1", name: "Iwikau Lodge" }] }));
    const body = await res.json();
    expect(body).toMatchObject({ updated: 1, created: 0, skipped: 0 });
    expect(body.results[0]).toEqual({ id: "l1", name: "Iwikau Lodge", status: "updated" });
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "l1", deletedAt: null });
    expect(call.data.name).toBe("Iwikau Lodge");
    expect(call.data.updatedAt).toBeInstanceOf(Date);
    expect(create).not.toHaveBeenCalled();
    const audit = auditCreate.mock.calls.at(-1)?.[0].data;
    expect(JSON.parse(JSON.stringify(audit.metadata))).toMatchObject({
      updated: 1,
      renamed: 1,
      renamedLodges: [{ id: "l1", from: "Whakapapa Lodge", to: "Iwikau Lodge" }],
    });
  });

  it("renames and applies the other changed fields in the same write", async () => {
    rows(dbRow());
    await POST(req("POST", { lodges: [{ id: "l1", name: "Iwikau Lodge", bedCapacity: 30 }] }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toMatchObject({ name: "Iwikau Lodge", bedCapacity: 30 });
  });

  it("an id with the stored name and nothing changed is 'unchanged' and writes nothing", async () => {
    rows(dbRow());
    const res = await POST(
      req("POST", { lodges: [{ id: "l1", name: "Whakapapa Lodge", bedCapacity: 24 }] }),
    );
    expect((await res.json()).unchanged).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["another lodge holds", "Tasman Lodge"],
    ["only LOOKS like another lodge's", "tasman lodge"],
  ])("renames onto a name %s: names may repeat (#69)", async (_l, name) => {
    rows(dbRow(), dbRow({ id: "l2", name: "Tasman Lodge", sourceClubId: "club_2" }));
    const body = await (await POST(req("POST", { lodges: [{ id: "l1", name }] }))).json();
    expect(body).toMatchObject({ updated: 1, skipped: 0 });
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: "l1", deletedAt: null }, data: { name } });
  });

  it("allows a rename that only changes the lodge's own case or spacing", async () => {
    rows(dbRow());
    findMany.mockResolvedValue([{ name: "Whakapapa Lodge" }, { name: "Tasman Lodge" }]);
    const res = await POST(req("POST", { lodges: [{ id: "l1", name: "WHAKAPAPA Lodge" }] }));
    expect((await res.json()).updated).toBe(1);
    expect(update.mock.calls[0][0].data.name).toBe("WHAKAPAPA Lodge");
  });

  it("an unknown id is skipped as unknown-id and is never created", async () => {
    rows(null);
    const res = await POST(req("POST", { lodges: [{ id: "gone", name: "Brand New Lodge" }] }));
    const body = await res.json();
    expect(body).toMatchObject({ created: 0, skipped: 1 });
    expect(body.results[0]).toEqual({
      id: "gone",
      name: "Brand New Lodge",
      status: "skipped",
      reason: "unknown-id",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["owned centrally", null, "owned-centrally"],
    ["owned by another club", "club_2", "owned-by-other-club"],
  ])("cannot rename a lodge %s", async (_l, owner, reason) => {
    rows(dbRow({ sourceClubId: owner }));
    const res = await POST(req("POST", { lodges: [{ id: "l1", name: "Hijacked Lodge" }] }));
    expect((await res.json()).results[0]).toMatchObject({ status: "skipped", reason });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id", ""],
    ["a blank id", "   "],
    ["an over-long id", "x".repeat(65)],
    ["a number", 7],
  ])("400 for %s, writing nothing", async (_l, id) => {
    const res = await POST(req("POST", { lodges: [{ id, name: "Whakapapa Lodge" }] }));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("an item without an id matches the club's own lodge of that name, and never renames it", async () => {
    findUnique.mockResolvedValue(dbRow());
    await POST(req("POST", { lodges: [{ name: "Whakapapa Lodge", bedCapacity: 99 }] }));
    expect(findUnique.mock.calls[0][0].where).toEqual({ name: "Whakapapa Lodge", sourceClubId: "club_1" });
    expect(update.mock.calls[0][0].data.name).toBeUndefined();
  });
});

describe("POST /api/v1/other-lodges (upload): season end dates (API 2.6)", () => {
  it("stores the end dates the item carries", async () => {
    findUnique.mockResolvedValue(dbRow());
    const res = await POST(
      req("POST", {
        lodges: [{ id: "l1", name: "Whakapapa Lodge", winterSeasonStart: "2026-06-01", winterSeasonEnd: "2026-09-30" }],
      }),
    );
    expect((await res.json()).updated).toBe(1);
    expect(update.mock.calls[0][0].data.winterSeasonEnd.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("skips a lodge whose seasons would overlap (its dates over the stored ones), and goes on", async () => {
    findUnique.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id === "l1"
        ? dbRow({ summerSeasonStart: new Date("2026-12-01T00:00:00.000Z") })
        : dbRow({ id: "l2", name: "Tasman Lodge" }),
    );
    const res = await POST(
      req("POST", {
        lodges: [
          { id: "l1", name: "Whakapapa Lodge", winterSeasonStart: "2026-06-01", winterSeasonEnd: "2026-12-20" },
          { id: "l2", name: "Tasman Lodge", bedCapacity: 30 },
        ],
      }),
    );
    const body = await res.json();
    expect(body.results[0]).toEqual({ id: "l1", name: "Whakapapa Lodge", status: "skipped", reason: "seasons" });
    expect(body.results[1]).toMatchObject({ id: "l2", status: "updated" });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
