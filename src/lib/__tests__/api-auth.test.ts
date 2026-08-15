import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma singleton before importing the module under test.
const findFirst = vi.fn();
const update = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: { apiToken: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => update(...a) } },
}));

import { authenticateApiRequest } from "@/lib/api-auth";
import { generateApiToken } from "@/lib/api-tokens";

function reqWithAuth(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://server/api/v1/sync", { method: "POST", headers });
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  const gen = generateApiToken();
  return {
    gen,
    row: {
      id: "tok_1",
      clubId: "club_1",
      name: "Key",
      tokenHash: gen.hash,
      tokenPrefix: gen.prefix,
      scopes: ["sync:read", "sync:write"],
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      club: {
        id: "club_1",
        name: "Ruapehu Lodge",
        code: "RUAPEHU",
        status: "APPROVED",
      },
      ...overrides,
    },
  };
}

describe("authenticateApiRequest", () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockClear();
  });

  it("rejects a request with no token (401)", async () => {
    const res = await authenticateApiRequest(reqWithAuth());
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a malformed token (401)", async () => {
    const res = await authenticateApiRequest(reqWithAuth("not-a-token"));
    expect(res).toMatchObject({ ok: false, status: 401 });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects an unknown token prefix (401)", async () => {
    findFirst.mockResolvedValue(null);
    const gen = generateApiToken();
    const res = await authenticateApiRequest(reqWithAuth(gen.plaintext));
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a valid prefix with the wrong secret (401)", async () => {
    const { row } = tokenRow();
    findFirst.mockResolvedValue(row);
    // A different token that happens to be presented — hash will not match.
    const other = generateApiToken();
    const forged = `${row.tokenPrefix}_${other.plaintext.split("_")[2]}`;
    const res = await authenticateApiRequest(reqWithAuth(forged));
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a revoked token (403)", async () => {
    const { gen, row } = tokenRow({ revokedAt: new Date() });
    findFirst.mockResolvedValue(row);
    const res = await authenticateApiRequest(reqWithAuth(gen.plaintext));
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a token whose club is not approved (403)", async () => {
    const { gen, row } = tokenRow({
      club: { id: "club_1", name: "X", code: "X", status: "PENDING" },
    });
    findFirst.mockResolvedValue(row);
    const res = await authenticateApiRequest(reqWithAuth(gen.plaintext));
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("accepts a valid token and stamps last-used", async () => {
    const { gen, row } = tokenRow();
    findFirst.mockResolvedValue(row);
    const res = await authenticateApiRequest(reqWithAuth(gen.plaintext));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.client.club.code).toBe("RUAPEHU");
      expect(res.client.token.id).toBe("tok_1");
    }
    expect(update).toHaveBeenCalledOnce();
  });

  it("accepts the token via the X-API-Key header too", async () => {
    const { gen, row } = tokenRow();
    findFirst.mockResolvedValue(row);
    const headers = new Headers({ "x-api-key": gen.plaintext });
    const res = await authenticateApiRequest(
      new Request("https://server/api/v1/sync", { method: "POST", headers }),
    );
    expect(res.ok).toBe(true);
  });
});
