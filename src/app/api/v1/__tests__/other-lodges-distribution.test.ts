import { describe, it, expect, vi, beforeEach } from "vitest";

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
  distribute: true,
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
  findMany.mockReset();
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

  it("returns distribute=true rows with a cursor", async () => {
    authenticate.mockResolvedValue(authOk(["lodges:read"]));
    findMany.mockResolvedValue([dbRow()]);
    const res = await GET(req("GET", url));
    expect(res.status).toBe(200);
    // Only distributed rows are queried.
    expect(findMany.mock.calls[0][0].where).toMatchObject({ distribute: true });
    const json = await res.json();
    expect(json.count).toBe(1);
    expect(json.lodges[0]).toMatchObject({ name: "Whakapapa Lodge" });
    // Client shape omits internal fields.
    expect(json.lodges[0]).not.toHaveProperty("distribute");
    expect(json.lodges[0]).not.toHaveProperty("sourceClub");
    expect(json.cursor).toBe("2026-02-01T00:00:00.000Z");
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

  it("creates a new lodge stamped with the club as source, not distributed", async () => {
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
    expect(data.distribute).toBe(false);
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
    // The update must not touch distribution or provenance.
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("distribute");
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
