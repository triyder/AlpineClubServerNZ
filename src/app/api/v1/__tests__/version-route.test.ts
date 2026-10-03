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

const upsert = vi.fn();
const issueUpdate = vi.fn();
const clubUpdate = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
const lodgeFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    syncIssue: {
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => issueUpdate(...a),
    },
    club: { update: (...a: unknown[]) => clubUpdate(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    otherLodge: { findMany: (...a: unknown[]) => lodgeFindMany(...a) },
  },
}));

import { GET } from "@/app/api/v1/version/route";
import { GET as pullLodges } from "@/app/api/v1/other-lodges/route";
import { SERVER_API_VERSION } from "@/lib/api-version";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED", lastReportedApiVersion: null };
const authOk = (scopes: string[] = ["lodges:read"]) => ({
  ok: true,
  client: { club: CLUB, token: { id: "tok_1", scopes } },
});

function get(url: string, version?: string) {
  return new Request(url, {
    method: "GET",
    headers: {
      authorization: "Bearer acs_x_y",
      ...(version === undefined ? {} : { "x-client-api-version": version }),
    },
  });
}

const auditActions = () =>
  auditCreate.mock.calls.map((c) => (c[0] as { data: { action: string } }).data.action);

beforeEach(() => {
  authenticate.mockReset();
  upsert.mockReset().mockResolvedValue({});
  issueUpdate.mockReset().mockResolvedValue({});
  clubUpdate.mockReset().mockResolvedValue({});
  auditCreate.mockReset().mockResolvedValue({});
  lodgeFindMany.mockReset().mockResolvedValue([]);
  resetRateLimits();
});

describe("GET /api/v1/version", () => {
  it("rejects an unauthenticated caller and records nothing", async () => {
    authenticate.mockResolvedValue({ ok: false, status: 401, error: "Missing API token" });
    const res = await GET(get("https://c.test/api/v1/version", SERVER_API_VERSION));
    expect(res.status).toBe(401);
    expect(auditCreate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns the server version and match=true, with no issue, on a matching version", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await GET(get("https://c.test/api/v1/version", SERVER_API_VERSION));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: SERVER_API_VERSION, match: true });
    expect(upsert).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["api.version.check"]);
    expect(clubUpdate).toHaveBeenCalledWith({
      where: { id: "club_1" },
      data: expect.objectContaining({ lastReportedApiVersion: SERVER_API_VERSION }),
    });
  });

  it("answers 200 with the server number on a mismatch, audits a FAILURE, and opens one issue", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await GET(get("https://c.test/api/v1/version", "0.9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: SERVER_API_VERSION, match: false });

    expect(auditActions()).toEqual(["api.version.check", "api.version.mismatch"]);
    const mismatch = auditCreate.mock.calls[1][0].data;
    expect(mismatch.outcome).toBe("FAILURE");
    expect(mismatch.metadata).toMatchObject({
      clientVersion: "0.9",
      serverVersion: SERVER_API_VERSION,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ openKey: "club_1:VERSION_MISMATCH" });
    expect(arg.create).toMatchObject({
      kind: "VERSION_MISMATCH",
      clubId: "club_1",
      clientVersion: "0.9",
      serverVersion: SERVER_API_VERSION,
      openKey: "club_1:VERSION_MISMATCH",
    });
    expect(arg.update.occurrences).toEqual({ increment: 1 });
  });

  it("falls back to updating the open issue when a racing request created it first (P2002)", async () => {
    authenticate.mockResolvedValue(authOk());
    upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const res = await GET(get("https://c.test/api/v1/version", "0.9"));
    expect(res.status).toBe(200);
    expect(issueUpdate).toHaveBeenCalledWith({
      where: { openKey: "club_1:VERSION_MISMATCH" },
      data: expect.objectContaining({ occurrences: { increment: 1 }, clientVersion: "0.9" }),
    });
  });

  it("answers with the version and match=null, and opens no issue, when the caller declares none", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await GET(get("https://c.test/api/v1/version"));
    expect(await res.json()).toEqual({ version: SERVER_API_VERSION, match: null });
    expect(upsert).not.toHaveBeenCalled();
    expect(clubUpdate).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["api.version.check"]);
  });

  it("rejects a malformed declared version with 400", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await GET(get("https://c.test/api/v1/version", "one.zero"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("API_VERSION_INVALID");
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("version gate on a data route (other-lodges pull)", () => {
  it("lets a request with no declared version through unchanged", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges"));
    expect(res.status).toBe(200);
    expect(lodgeFindMany).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lets a matching version through", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", SERVER_API_VERSION));
    expect(res.status).toBe(200);
    expect(lodgeFindMany).toHaveBeenCalled();
  });

  it("refuses a differing version with 409 BEFORE any data is read, and records the issue", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "API_VERSION_MISMATCH",
      serverVersion: SERVER_API_VERSION,
      clientVersion: "0.9",
    });
    expect(lodgeFindMany).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(auditActions()).toEqual(["api.version.mismatch"]);
  });

  it("refuses a malformed declared version with 400 before any data is read", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", "x"));
    expect(res.status).toBe(400);
    expect(lodgeFindMany).not.toHaveBeenCalled();
  });
});
