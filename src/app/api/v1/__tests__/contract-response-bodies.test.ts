import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * THE SECOND HALF OF THE CONTRACT GUARD (see `src/lib/__tests__/api-contract.test.ts`).
 *
 * The fingerprint there hashes the route surface, the request schemas and
 * the shapes built by the shared serialisers (`serializeOtherLodgeForClient`,
 * the lodge pull envelope, `serializePostForClient`). It does NOT see a
 * response body a route builds inline, nor the sync entry wrapper. Those are
 * what clubs read too, so this file pins each of them as a literal key
 * structure, read through the route with the usual mocks.
 *
 * WHEN IT FAILS: a club-facing response shape changed. That is a contract
 * change — bump SERVER_API_VERSION (and record the new fingerprint in
 * api-contract-fingerprints.json) before updating the expectation here.
 */

const BUMP =
  "This is a /api/v1 response shape clubs read. Changing it needs a SERVER_API_VERSION bump (see api-version.ts) — then update this pin.";

const authenticate = vi.fn();
vi.mock("@/lib/api-auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    authenticateApiRequest: (...a: unknown[]) => authenticate(...a),
  };
});

const postFindMany = vi.fn();
const clubFindUnique = vi.fn();
const clubUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    post: { findMany: (...a: unknown[]) => postFindMany(...a) },
    club: {
      findUnique: (...a: unknown[]) => clubFindUnique(...a),
      update: (...a: unknown[]) => clubUpdate(...a),
    },
    auditLog: { create: async () => ({}) },
  },
}));
vi.mock("@/lib/settings", () => ({
  loadPostSettings: async () => ({
    retentionDays: 365,
    autoHideThreshold: 3,
    autoHideMinClubs: 1,
    tombstoneHorizonDays: 90,
  }),
}));
vi.mock("@/lib/push-targets", async (orig) => {
  const actual = await orig<typeof import("@/lib/push-targets")>();
  return { ...actual, validatePushTarget: async (url: string) => url };
});

import { GET as feed } from "@/app/api/v1/feed/route";
import { GET as feedSync } from "@/app/api/v1/feed/sync/route";
import { GET as version } from "@/app/api/v1/version/route";
import { PUT as putPushTarget } from "@/app/api/v1/push-target/route";
import { serializePostForSync, type PostRecord } from "@/lib/posts";
import { SERVER_API_VERSION } from "@/lib/api-version";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED", lastReportedApiVersion: null };
const at = new Date("2026-08-02T00:00:00.000Z");

const post = (over: Record<string, unknown> = {}) =>
  ({
    id: "p1",
    clubId: CLUB.id,
    club: { id: CLUB.id, name: "Ruapehu Club", code: "RUAPEHU" },
    authorUserId: "u",
    authorName: "Jo",
    authorEmail: null,
    content: "c",
    bodyHtml: null,
    reportCount: 0,
    hiddenAt: null,
    hiddenBy: null,
    autoHideExempt: false,
    removedAt: null,
    removedBy: null,
    createdAt: at,
    updatedAt: at,
    images: [
      { id: "i", publicId: "x".repeat(32), storageKey: "s", width: 1, height: 1, bytes: 1, position: 0 },
    ],
    ...over,
  }) as unknown as PostRecord;

/** The key structure of a value: arrays by their first element, leaves by type. */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, shapeOf((value as Record<string, unknown>)[k])]),
    );
  }
  return value === null ? "null" : typeof value;
}

const req = (url: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer acs_x_y",
      host: "server.test",
      "x-forwarded-proto": "https",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const savedKey = process.env.PUSH_SIGNING_KEY;

beforeEach(() => {
  resetRateLimits();
  authenticate.mockReset().mockResolvedValue({
    ok: true,
    client: { club: CLUB, token: { id: "tok_1", scopes: ["posts:read", "posts:write"] } },
  });
  postFindMany.mockReset().mockResolvedValue([post()]);
  clubFindUnique.mockReset().mockResolvedValue({ pushUrl: null, pushSecretVersion: 1 });
  clubUpdate.mockReset().mockResolvedValue({});
  process.env.PUSH_SIGNING_KEY = "k".repeat(40);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.PUSH_SIGNING_KEY;
  else process.env.PUSH_SIGNING_KEY = savedKey;
});

const POST_SHAPE = {
  authorName: "string",
  bodyHtml: "null",
  club: { code: "string", id: "string", name: "string" },
  content: "string",
  createdAt: "string",
  id: "string",
  images: [{ height: "number", url: "string", width: "number" }],
  updatedAt: "string",
};

describe("serializePostForSync entries", () => {
  it("a visible post", () => {
    expect(shapeOf(serializePostForSync(post(), "https://s")), BUMP).toEqual({
      post: POST_SHAPE,
      state: "string",
    });
  });

  it("a removed (or hidden) post carries ids only", () => {
    expect(shapeOf(serializePostForSync(post({ removedAt: at }), "https://s")), BUMP).toEqual({
      id: "string",
      reason: "string",
      state: "string",
    });
    expect(shapeOf(serializePostForSync(post({ hiddenAt: at }), "https://s")), BUMP).toEqual({
      id: "string",
      reason: "string",
      state: "string",
    });
  });
});

describe("response bodies built inline by the routes", () => {
  it("GET /api/v1/feed/sync", async () => {
    postFindMany.mockResolvedValue([post(), post({ id: "p2", removedAt: at })]);
    const body = await (await feedSync(req("https://server.test/api/v1/feed/sync?since=2026-08-01T00:00:00.000Z"))).json();
    expect(shapeOf(body), BUMP).toEqual({
      changes: [{ post: POST_SHAPE, state: "string" }],
      cursor: { since: "string", sinceId: "string" },
      hasMore: "boolean",
      tombstoneHorizon: "string",
    });
    // The empty page: cursor is null, not an object.
    postFindMany.mockResolvedValue([]);
    const empty = await (await feedSync(req("https://server.test/api/v1/feed/sync"))).json();
    expect(shapeOf(empty), BUMP).toEqual({
      changes: [],
      cursor: "null",
      hasMore: "boolean",
      tombstoneHorizon: "string",
    });
  });

  it("GET /api/v1/feed", async () => {
    const body = await (await feed(req("https://server.test/api/v1/feed?limit=1"))).json();
    expect(shapeOf(body), BUMP).toEqual({
      count: "number",
      cursor: { before: "string", beforeId: "string" },
      posts: [POST_SHAPE],
    });
  });

  it("GET /api/v1/version", async () => {
    const body = await (
      await version(
        req("https://server.test/api/v1/version", {
          headers: { "x-client-api-version": SERVER_API_VERSION },
        }),
      )
    ).json();
    expect(shapeOf(body), BUMP).toEqual({ match: "boolean", version: "string" });
    expect(body.version).toBe(SERVER_API_VERSION);
  });

  it("PUT /api/v1/push-target", async () => {
    const body = await (
      await putPushTarget(
        req("https://server.test/api/v1/push-target", {
          method: "PUT",
          body: JSON.stringify({ url: "https://club.example/api/push" }),
        }),
      )
    ).json();
    expect(shapeOf(body), BUMP).toEqual({
      secret: "string",
      secretVersion: "number",
      signature: { algorithm: "string", header: "string", timestampHeader: "string" },
      url: "string",
    });
  });
});
