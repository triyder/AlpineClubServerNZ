import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Mock token auth: tests set what the authenticated client looks like.
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
const auditCreate = vi.fn().mockResolvedValue({});
/** The pull's three reads, told apart by their `where` (#16). */
function pullReads(rows: { live?: unknown[]; deleted?: unknown[] }) {
  findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    if ("sourceClubId" in where) return [];
    if (where.deletedAt !== null && where.deletedAt !== undefined) return rows.deleted ?? [];
    return rows.live ?? [];
  });
}
vi.mock("@/lib/db", () => ({
  prisma: {
    otherLodge: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET, POST } from "@/app/api/v1/other-lodges/route";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED" };
function authOk(scopes: string[], tokenId = "tok_1") {
  return {
    ok: true,
    client: { club: CLUB, token: { id: tokenId, scopes } },
  };
}

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  name: "Whakapapa Lodge",
  location: "Mt Ruapehu",
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
  summerSeasonStart: null,
  amenities: [],
  sourceClubId: null,
  sourceClub: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  ...over,
});

function req(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { authorization: "Bearer acs_x_y", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  authenticate.mockReset();
  // The pull's two queries and the upload's lookalike check; GET tests override.
  findMany.mockReset().mockResolvedValue([]);
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  auditCreate.mockClear();
  resetRateLimits();
});

describe("GET /api/v1/other-lodges (pull)", () => {
  const url = "https://s/api/v1/other-lodges";

  it("401 when the token is invalid", async () => {
    authenticate.mockResolvedValue({ ok: false, status: 401, error: "Invalid API token" });
    const res = await GET(req("GET", url));
    expect(res.status).toBe(401);
  });

  it("403 when the token lacks the read scope", async () => {
    authenticate.mockResolvedValue(authOk(["sync:write"]));
    const res = await GET(req("GET", url));
    expect(res.status).toBe(403);
  });

  it("returns every lodge, unfiltered, with a cursor", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    findMany.mockResolvedValue([dbRow()]);
    const res = await GET(req("GET", url));
    expect(res.status).toBe(200);
    // Every lodge is distributed: no per-row marker narrows the query.
    expect(findMany.mock.calls[0][0].where ?? {}).not.toHaveProperty("distribute");
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(json.lodges[0]).toMatchObject({ name: "Whakapapa Lodge" });
    // Client shape omits internal fields.
    expect(json.lodges[0]).not.toHaveProperty("distribute");
    expect(json.lodges[0]).not.toHaveProperty("sourceClub");
    expect(json.cursor).toBe("2026-02-01T00:00:00.000Z");
  });

  it("never sends a deleted lodge as a lodge, and reports deletions since the cursor, oldest first (#16)", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    pullReads({ deleted: [{ id: "gone_1", deletedAt: new Date("2026-03-01T00:00:00.000Z") }] });
    const json = await (await GET(req("GET", `${url}?since=2026-02-15T00:00:00.000Z`))).json();
    const reads = findMany.mock.calls.map(([args]) => args.where ?? {});
    // The lodges and the owned list are LIVE lodges only.
    expect(reads[0].deletedAt).toBeNull();
    expect(reads[1]).toMatchObject({ deletedAt: null });
    // The deletions read: deleted since the cursor, oldest first.
    expect(reads[2].deletedAt.gt.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(findMany.mock.calls[2][0].orderBy).toEqual({ deletedAt: "asc" });
    expect(json.deletedLodges).toEqual([{ id: "gone_1", deletedAt: "2026-03-01T00:00:00.000Z" }]);
    // A pull that carried only a deletion still moves the cursor past it.
    expect(json.cursor).toBe("2026-03-01T00:00:00.000Z");
  });

  it("sends EVERY deletion on a pull without a cursor", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    pullReads({});
    await GET(req("GET", url));
    expect(findMany.mock.calls[2][0].where).toEqual({ deletedAt: { not: null } });
  });

  it("takes the newest of the lodges' and the deletions' instants as the cursor", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    pullReads({
      live: [dbRow()],
      deleted: [{ id: "gone_1", deletedAt: new Date("2026-01-10T00:00:00.000Z") }],
    });
    const json = await (await GET(req("GET", url))).json();
    // dbRow's updatedAt (1 Feb) is newer than the deletion (10 Jan).
    expect(json.cursor).toBe("2026-02-01T00:00:00.000Z");
  });

  it("skips an upload that loses a race with a Delete (the guarded write finds no live row)", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    findUnique.mockResolvedValue({ id: "l1", name: "Tasman Lodge", sourceClubId: "club_1", deletedAt: null });
    update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record not found", { code: "P2025", clientVersion: "x" }),
    );
    const body = await (await POST(req("POST", url, { lodges: [{ name: "Tasman Lodge", bedCapacity: 5 }] }))).json();
    expect(update.mock.calls[0][0].where).toEqual({ id: "l1", deletedAt: null });
    expect(body.results[0]).toEqual({ name: "Tasman Lodge", status: "skipped", reason: "deleted" });
  });

  it("skips an upload of a deleted lodge, by name or by id, writing nothing (#16)", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    findUnique.mockResolvedValue({ id: "l1", name: "Tasman Lodge", sourceClubId: "club_1", deletedAt: new Date() });
    const byName = await (await POST(req("POST", url, { lodges: [{ name: "Tasman Lodge", bedCapacity: 3 }] }))).json();
    const byId = await (await POST(req("POST", url, { lodges: [{ id: "l1", name: "Tasman Lodge" }] }))).json();
    expect(byName.results[0]).toEqual({ name: "Tasman Lodge", status: "skipped", reason: "deleted" });
    expect(byId.results[0]).toEqual({ name: "Tasman Lodge", status: "skipped", reason: "deleted" });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("passes ?since through as an updatedAt filter", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    findMany.mockResolvedValue([]);
    const res = await GET(req("GET", `${url}?since=2026-01-15T00:00:00.000Z`));
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].where.updatedAt.gt).toBeInstanceOf(Date);
  });

  it("400 on a malformed ?since", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    const res = await GET(req("GET", `${url}?since=not-a-date`));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/other-lodges (upload)", () => {
  const url = "https://s/api/v1/other-lodges";

  it("403 when the token lacks the write scope", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    const res = await POST(req("POST", url, { lodges: [{ name: "X" }] }));
    expect(res.status).toBe(403);
  });

  it("400 on an invalid payload", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    const res = await POST(req("POST", url, { lodges: [] }));
    expect(res.status).toBe(400);
  });

  it("creates a new lodge stamped with the club as source", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({});
    const res = await POST(
      req("POST", url, { lodges: [{ name: "Tasman Lodge", bedCapacity: 12 }] }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    const data = create.mock.calls[0][0].data;
    expect(data.sourceClubId).toBe("club_1");
    expect(data).not.toHaveProperty("distribute");
  });

  it("updates an entry owned by the same club", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    findUnique.mockResolvedValue({ id: "l1", sourceClubId: "club_1" });
    update.mockResolvedValue({});
    const res = await POST(
      req("POST", url, { lodges: [{ name: "Tasman Lodge", bedCapacity: 20 }] }),
    );
    const json = await res.json();
    expect(json).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    // The update must not touch provenance.
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("sourceClubId");
  });

  it("reports unchanged (no write) when an owned entry is identical", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    findUnique.mockResolvedValue({
      id: "l1",
      sourceClubId: "club_1",
      location: "Mt Ruapehu",
      bookingOfficerName: null,
      bookingOfficerEmail: null,
      bookingOfficerPhone: null,
      bedCapacity: 20,
    });
    const res = await POST(
      req("POST", url, {
        lodges: [{ name: "Tasman Lodge", location: "Mt Ruapehu", bedCapacity: 20 }],
      }),
    );
    const json = await res.json();
    expect(json).toMatchObject({ created: 0, updated: 0, unchanged: 1, skipped: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(json.results[0]).toMatchObject({ status: "unchanged" });
  });

  it("skips an entry owned centrally or by another club (no clobber)", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:write"]));
    findUnique.mockResolvedValue({ id: "l1", sourceClubId: null }); // central
    const res = await POST(
      req("POST", url, { lodges: [{ name: "Central Lodge" }] }),
    );
    const json = await res.json();
    expect(json).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(json.results[0]).toMatchObject({ status: "skipped", reason: "owned-centrally" });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
