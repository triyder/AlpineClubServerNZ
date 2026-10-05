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
import {
  VERSION_RECORDING_MAX_PER_MINUTE,
  VERSION_STAMP_STALE_MS,
} from "@/lib/sync-issues";

const CLUB = {
  id: "club_1",
  code: "RUAPEHU",
  status: "APPROVED",
  lastReportedApiVersion: null as string | null,
  lastVersionCheckAt: null as Date | null,
};
const authOk = (scopes: string[] = ["lodges:read"], club: Partial<typeof CLUB> = {}) => ({
  ok: true,
  client: { club: { ...CLUB, ...club }, token: { id: "tok_1", scopes } },
});

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test" });

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

  it("rejects a malformed declared version with 400, and audits it as a FAILURE", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await GET(get("https://c.test/api/v1/version", "one.zero"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid client API version",
      code: "API_VERSION_INVALID",
      serverVersion: SERVER_API_VERSION,
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["api.version.invalid"]);
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.outcome).toBe("FAILURE");
    expect(audit.metadata).toMatchObject({
      declared: "one.zero",
      serverVersion: SERVER_API_VERSION,
      path: "/api/v1/version",
    });
  });

  it("retries the upsert once when the open issue was cleared between the create race and the update (P2025)", async () => {
    authenticate.mockResolvedValue(authOk());
    upsert.mockRejectedValueOnce(prismaError("P2002")).mockResolvedValueOnce({});
    issueUpdate.mockRejectedValueOnce(prismaError("P2025"));
    const res = await GET(get("https://c.test/api/v1/version", "0.9"));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(issueUpdate).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second attempt rather than retrying forever", async () => {
    authenticate.mockResolvedValue(authOk());
    upsert.mockRejectedValue(prismaError("P2002"));
    issueUpdate.mockRejectedValue(prismaError("P2025"));
    await expect(GET(get("https://c.test/api/v1/version", "0.9"))).rejects.toMatchObject({
      code: "P2025",
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(issueUpdate).toHaveBeenCalledTimes(2);
  });

  it("re-throws anything other than P2025 from the fallback update", async () => {
    authenticate.mockResolvedValue(authOk());
    upsert.mockRejectedValue(prismaError("P2002"));
    issueUpdate.mockRejectedValue(new Error("connection lost"));
    await expect(GET(get("https://c.test/api/v1/version", "0.9"))).rejects.toThrow(
      "connection lost",
    );
    expect(upsert).toHaveBeenCalledTimes(1);
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

  it("refuses a malformed declared version with 400 before any data is read, and audits it", async () => {
    authenticate.mockResolvedValue(authOk());
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", "x"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid client API version",
      code: "API_VERSION_INVALID",
      serverVersion: SERVER_API_VERSION,
    });
    expect(lodgeFindMany).not.toHaveBeenCalled();
    expect(clubUpdate).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["api.version.invalid"]);
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.outcome).toBe("FAILURE");
    expect(audit.metadata).toMatchObject({ declared: "x", path: "/api/v1/other-lodges" });
  });

  it("strips control characters from, and caps, the malformed value it audits", async () => {
    authenticate.mockResolvedValue(authOk());
    const hostile = `1.\u001b[31m0\u0000${"z".repeat(200)}`;
    const res = await pullLodges(
      get(`https://c.test/api/v1/other-lodges?clientVersion=${encodeURIComponent(hostile)}`),
    );
    expect(res.status).toBe(400);
    const declared = auditCreate.mock.calls[0][0].data.metadata.declared as string;
    expect(declared).not.toMatch(/[\u0000-\u001f]/);
    expect(declared.startsWith("1.[31m0zzz")).toBe(true);
    expect(declared.length).toBe(64);
  });
});

describe("the gate bounds what a refused request may write", () => {
  const MAX = VERSION_RECORDING_MAX_PER_MINUTE;

  it(`records at most ${MAX} mismatches a minute per token, and still answers 409 after that`, async () => {
    authenticate.mockResolvedValue(authOk());
    for (let i = 0; i < MAX; i += 1) {
      const res = await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
      expect(res.status).toBe(409);
    }
    expect(upsert).toHaveBeenCalledTimes(MAX);
    expect(auditCreate).toHaveBeenCalledTimes(MAX);
    expect(clubUpdate).toHaveBeenCalledTimes(MAX);

    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("API_VERSION_MISMATCH");
    expect(lodgeFindMany).not.toHaveBeenCalled();
    // Over the allowance: refused exactly the same, but nothing more is written.
    expect(upsert).toHaveBeenCalledTimes(MAX);
    expect(auditCreate).toHaveBeenCalledTimes(MAX);
    expect(clubUpdate).toHaveBeenCalledTimes(MAX);
  });

  it("the malformed-version audit row shares the same allowance", async () => {
    authenticate.mockResolvedValue(authOk());
    for (let i = 0; i < MAX; i += 1) {
      await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
    }
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", "x"));
    expect(res.status).toBe(400);
    expect(auditCreate).toHaveBeenCalledTimes(MAX);
  });

  it("is per token: another token's recordings are not held back", async () => {
    authenticate.mockResolvedValue(authOk());
    for (let i = 0; i < MAX; i += 1) {
      await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
    }
    authenticate.mockResolvedValue({
      ok: true,
      client: { club: CLUB, token: { id: "tok_2", scopes: ["lodges:read"] } },
    });
    await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
    expect(upsert).toHaveBeenCalledTimes(MAX + 1);
  });

  it("a matching version is stamped regardless of the allowance", async () => {
    authenticate.mockResolvedValue(authOk());
    for (let i = 0; i < MAX; i += 1) {
      await pullLodges(get("https://c.test/api/v1/other-lodges", "0.9"));
    }
    clubUpdate.mockClear();
    const res = await pullLodges(get("https://c.test/api/v1/other-lodges", SERVER_API_VERSION));
    expect(res.status).toBe(200);
    expect(clubUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("stamping the reported version", () => {
  const url = "https://c.test/api/v1/other-lodges";

  it("writes when the value changed", async () => {
    authenticate.mockResolvedValue(
      authOk(["lodges:read"], { lastReportedApiVersion: "0.9", lastVersionCheckAt: new Date() }),
    );
    await pullLodges(get(url, SERVER_API_VERSION));
    expect(clubUpdate).toHaveBeenCalledTimes(1);
    expect(clubUpdate.mock.calls[0][0].data).toMatchObject({
      lastReportedApiVersion: SERVER_API_VERSION,
    });
    expect(clubUpdate.mock.calls[0][0].data.lastVersionCheckAt).toBeInstanceOf(Date);
  });

  it("does not write when the value is unchanged and was checked recently", async () => {
    authenticate.mockResolvedValue(
      authOk(["lodges:read"], {
        lastReportedApiVersion: SERVER_API_VERSION,
        lastVersionCheckAt: new Date(Date.now() - 10 * 60 * 1000),
      }),
    );
    await pullLodges(get(url, SERVER_API_VERSION));
    expect(clubUpdate).not.toHaveBeenCalled();
  });

  it("refreshes an unchanged value whose last check is an hour old or older", async () => {
    authenticate.mockResolvedValue(
      authOk(["lodges:read"], {
        lastReportedApiVersion: SERVER_API_VERSION,
        lastVersionCheckAt: new Date(Date.now() - VERSION_STAMP_STALE_MS - 1),
      }),
    );
    await pullLodges(get(url, SERVER_API_VERSION));
    expect(clubUpdate).toHaveBeenCalledTimes(1);
  });

  it("refreshes an unchanged value that has never been stamped with a time", async () => {
    authenticate.mockResolvedValue(
      authOk(["lodges:read"], {
        lastReportedApiVersion: SERVER_API_VERSION,
        lastVersionCheckAt: null,
      }),
    );
    await pullLodges(get(url, SERVER_API_VERSION));
    expect(clubUpdate).toHaveBeenCalledTimes(1);
  });
});
