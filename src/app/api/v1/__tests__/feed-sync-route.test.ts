import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticate = vi.fn();
vi.mock("@/lib/api-auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    authenticateApiRequest: (...a: unknown[]) => authenticate(...a),
  };
});

const settings = vi.fn();
vi.mock("@/lib/settings", () => ({ loadPostSettings: () => settings() }));

const postFindMany = vi.fn();
const clubUpdate = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    post: { findMany: (...a: unknown[]) => postFindMany(...a) },
    club: { update: (...a: unknown[]) => clubUpdate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { GET } from "@/app/api/v1/feed/sync/route";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED" };

function authOk(scopes: string[] = ["posts:read"]) {
  return { ok: true, client: { club: CLUB, token: { id: "tok_1", scopes } } };
}

// Headers as Caddy presents them: it terminates TLS and forwards plain HTTP,
// so the scheme is only knowable from x-forwarded-proto.
function req(query = "", headers: Record<string, string> = {}) {
  return new Request(`https://server.test/api/v1/feed/sync${query}`, {
    headers: {
      authorization: "Bearer acs_x_y",
      host: "server.test",
      "x-forwarded-proto": "https",
      ...headers,
    },
  });
}

/** A stored post row as `postSelect` would return it. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    clubId: CLUB.id,
    club: { id: CLUB.id, name: "Ruapehu Club", code: "RUAPEHU" },
    authorUserId: "member-7",
    authorName: "Jo Whitcombe",
    authorEmail: "jo@example.test",
    content: "Hut book is back at the lodge.",
    reportCount: 0,
    hiddenAt: null,
    hiddenBy: null,
    autoHideExempt: false,
    removedAt: null,
    removedBy: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-02T00:00:00Z"),
    images: [
      {
        id: "img1",
        publicId: "a".repeat(32),
        storageKey: "posts/2026/08/x.webp",
        width: 1920,
        height: 1280,
        bytes: 100,
        position: 0,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  resetRateLimits();
  authenticate.mockReset().mockResolvedValue(authOk());
  postFindMany.mockReset().mockResolvedValue([]);
  clubUpdate.mockReset().mockResolvedValue({});
  auditCreate.mockReset().mockResolvedValue({});
  settings.mockReset().mockResolvedValue({
    retentionDays: 365,
    autoHideThreshold: 3,
    autoHideMinClubs: 1,
    tombstoneHorizonDays: 90,
  });
});

describe("GET /api/v1/feed/sync — removals", () => {
  it("emits hidden posts as removals carrying no content", async () => {
    postFindMany.mockResolvedValue([
      row({ id: "p2", hiddenAt: new Date("2026-08-03T00:00:00Z") }),
    ]);

    const body = await (await GET(req("?since=2026-08-01T00:00:00.000Z"))).json();

    expect(body.changes).toEqual([
      { state: "removed", id: "p2", reason: "hidden" },
    ]);
    // Shipping the body of a post that was hidden for being abusive would
    // defeat hiding it, so the entry must carry nothing but the id.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Hut book");
    expect(serialized).not.toContain("Jo Whitcombe");
  });

  it("emits removed posts as removals", async () => {
    postFindMany.mockResolvedValue([
      row({
        id: "p3",
        content: "",
        removedAt: new Date("2026-08-04T00:00:00Z"),
        removedBy: "ADMIN",
        images: [],
      }),
    ]);

    const body = await (await GET(req("?since=2026-08-01T00:00:00.000Z"))).json();
    expect(body.changes).toEqual([
      { state: "removed", id: "p3", reason: "removed" },
    ]);
  });

  it("reports removal even for a post that is both hidden and removed", async () => {
    postFindMany.mockResolvedValue([
      row({
        hiddenAt: new Date("2026-08-03T00:00:00Z"),
        removedAt: new Date("2026-08-04T00:00:00Z"),
      }),
    ]);
    const body = await (await GET(req("?since=2026-08-01T00:00:00.000Z"))).json();
    expect(body.changes[0].reason).toBe("removed");
  });
});

describe("GET /api/v1/feed/sync — visible posts", () => {
  it("never leaks author identifiers to other clubs", async () => {
    postFindMany.mockResolvedValue([row()]);

    const body = await (await GET(req())).json();
    const post = body.changes[0].post;

    expect(post.authorName).toBe("Jo Whitcombe");
    // Held for moderation, never serialized: the feed reaches every connected
    // club, so an email here would hand every club everyone else's addresses.
    expect(post).not.toHaveProperty("authorEmail");
    expect(post).not.toHaveProperty("authorUserId");
    expect(JSON.stringify(body)).not.toContain("jo@example.test");
    expect(JSON.stringify(body)).not.toContain("member-7");
  });

  it("builds absolute image URLs from the forwarded host", async () => {
    postFindMany.mockResolvedValue([row()]);
    const body = await (await GET(req())).json();

    expect(body.changes[0].post.images).toEqual([
      {
        url: `https://server.test/api/images/posts/${"a".repeat(32)}.webp`,
        width: 1920,
        height: 1280,
      },
    ]);
    // The on-disk path must never reach a client.
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(JSON.stringify(body)).not.toContain("posts/2026/08/x.webp");
  });

  it("honours an explicit PUBLIC_BASE_URL over the request headers", async () => {
    // Needed when the public origin differs from what reaches the app, e.g.
    // behind an extra proxy hop.
    process.env.PUBLIC_BASE_URL = "https://alpine.example.nz/";
    postFindMany.mockResolvedValue([row()]);
    try {
      const body = await (await GET(req())).json();
      // Trailing slash collapsed rather than doubled into the path.
      expect(body.changes[0].post.images[0].url).toBe(
        `https://alpine.example.nz/api/images/posts/${"a".repeat(32)}.webp`,
      );
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });
});

describe("GET /api/v1/feed/sync — cursor and paging", () => {
  it("a full sync returns visible posts only, not a backlog of tombstones", async () => {
    await GET(req());
    // A club joining the network has no mirror to correct, so tombstones for
    // posts it never held would be pure noise.
    expect(postFindMany.mock.calls[0][0].where).toEqual({
      hiddenAt: null,
      removedAt: null,
    });
  });

  it("an incremental sync filters on the composite cursor", async () => {
    await GET(req("?since=2026-08-02T00:00:00.000Z&sinceId=p1"));
    const where = postFindMany.mock.calls[0][0].where;

    // Paging on updatedAt alone would skip rows sharing the boundary
    // timestamp, or loop forever re-requesting them.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[1]).toMatchObject({ id: { gt: "p1" } });
    expect(postFindMany.mock.calls[0][0].orderBy).toEqual([
      { updatedAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("signals hasMore by over-fetching one row, and does not return it", async () => {
    const rows = Array.from({ length: 101 }, (_, i) =>
      row({ id: `p${i}`, updatedAt: new Date(2026, 7, 1, 0, 0, i) }),
    );
    postFindMany.mockResolvedValue(rows);

    const body = await (await GET(req("?limit=100"))).json();

    expect(postFindMany.mock.calls[0][0].take).toBe(101);
    expect(body.hasMore).toBe(true);
    expect(body.changes).toHaveLength(100);
    // The cursor must be the last RETURNED row, not the probe row, or the
    // next page would skip it.
    expect(body.cursor.sinceId).toBe("p99");
  });

  it("leaves the cursor null on an empty page", async () => {
    const body = await (await GET(req("?since=2026-08-02T00:00:00.000Z"))).json();
    // Advancing to "now" here would skip anything committed in between.
    expect(body.cursor).toBeNull();
    expect(body.hasMore).toBe(false);
  });

  it("rejects an unparseable cursor instead of resyncing from the start", async () => {
    const res = await GET(req("?since=not-a-date"));
    expect(res.status).toBe(400);
    expect(postFindMany).not.toHaveBeenCalled();
  });

  it("clamps limit to the maximum", async () => {
    await GET(req("?limit=9999"));
    expect(postFindMany.mock.calls[0][0].take).toBe(201);
  });

  it("advertises the tombstone horizon so a stale client can detect it", async () => {
    const body = await (await GET(req())).json();
    const horizon = new Date(body.tombstoneHorizon).getTime();
    const expected = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(Math.abs(horizon - expected)).toBeLessThan(5000);
  });
});

describe("GET /api/v1/feed/sync — sync stamping", () => {
  it("stamps lastCommsSyncAt so takedown convergence is observable", async () => {
    await GET(req());
    expect(clubUpdate).toHaveBeenCalledTimes(1);
    const call = clubUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: CLUB.id });
    expect(call.data.lastCommsSyncAt).toBeInstanceOf(Date);
  });

  it("still serves the page when the stamp fails", async () => {
    clubUpdate.mockRejectedValue(new Error("write conflict"));
    postFindMany.mockResolvedValue([row()]);

    const res = await GET(req());
    // A failed stamp costs takedown visibility, not the sync itself.
    expect(res.status).toBe(200);
    expect((await res.json()).changes).toHaveLength(1);
  });

  it("rejects a token without posts:read", async () => {
    authenticate.mockResolvedValue(authOk(["posts:write"]));
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(postFindMany).not.toHaveBeenCalled();
  });
});
