import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authenticate = vi.fn();
vi.mock("@/lib/api-auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    authenticateApiRequest: (...a: unknown[]) => authenticate(...a),
  };
});

const clubFindUnique = vi.fn();
const clubUpdate = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    club: {
      findUnique: (...a: unknown[]) => clubFindUnique(...a),
      update: (...a: unknown[]) => clubUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

// The address check resolves DNS; it is not what this file tests.
vi.mock("@/lib/push-targets", async (orig) => {
  const actual = await orig<typeof import("@/lib/push-targets")>();
  return { ...actual, validatePushTarget: async (url: string) => url };
});

import { PUT, DELETE } from "@/app/api/v1/push-target/route";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED", lastReportedApiVersion: null };
const authOk = (scopes: string[] = ["posts:write"]) => ({
  ok: true,
  client: { club: CLUB, token: { id: "tok_1", scopes } },
});

function put(body: unknown) {
  return new Request("https://c.test/api/v1/push-target", {
    method: "PUT",
    headers: { authorization: "Bearer acs_x_y", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function del() {
  return new Request("https://c.test/api/v1/push-target", {
    method: "DELETE",
    headers: { authorization: "Bearer acs_x_y" },
  });
}

const savedMax = process.env.RATE_LIMIT_MAX;
const savedKey = process.env.PUSH_SIGNING_KEY;

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue(authOk());
  clubFindUnique.mockReset().mockResolvedValue({ pushUrl: null, pushSecretVersion: 1 });
  clubUpdate.mockReset().mockResolvedValue({});
  auditCreate.mockClear();
  resetRateLimits();
  process.env.RATE_LIMIT_MAX = "3";
  process.env.PUSH_SIGNING_KEY = "k".repeat(40);
});

afterEach(() => {
  if (savedMax === undefined) delete process.env.RATE_LIMIT_MAX;
  else process.env.RATE_LIMIT_MAX = savedMax;
  if (savedKey === undefined) delete process.env.PUSH_SIGNING_KEY;
  else process.env.PUSH_SIGNING_KEY = savedKey;
});

describe("PUT /api/v1/push-target", () => {
  it("registers the target and returns the secret", async () => {
    const res = await PUT(put({ url: "https://club.example/api/push" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://club.example/api/push");
    expect(body.secretVersion).toBe(2);
    expect(clubUpdate).toHaveBeenCalledTimes(1);
  });

  it("is rate limited per token, before the scope check", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await PUT(put({ url: "https://club.example/api/push" }))).status).toBe(200);
    }
    const res = await PUT(put({ url: "https://club.example/api/push" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(clubUpdate).toHaveBeenCalledTimes(3);
  });

  it("403 without posts:write", async () => {
    authenticate.mockResolvedValue(authOk(["posts:read"]));
    expect((await PUT(put({ url: "https://club.example/api/push" }))).status).toBe(403);
  });
});

describe("DELETE /api/v1/push-target", () => {
  it("withdraws the target", async () => {
    const res = await DELETE(del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    expect(clubUpdate.mock.calls[0][0].data).toEqual({ pushUrl: null, pushEnabled: false });
  });

  it("shares the per-token limit with PUT", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await DELETE(del())).status).toBe(200);
    }
    expect((await DELETE(del())).status).toBe(429);
    expect(clubUpdate).toHaveBeenCalledTimes(3);
  });
});
