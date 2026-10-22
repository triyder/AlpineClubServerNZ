import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const recordAudit = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { apiToken: { create: (...a: unknown[]) => create(...a) } },
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { issueClubToken } from "@/lib/issue-club-token";
import { hashToken, parseTokenPrefix } from "@/lib/api-tokens";

describe("issueClubToken (#30)", () => {
  beforeEach(() => {
    create.mockReset();
    recordAudit.mockReset();
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "tok-1",
      ...data,
    }));
  });

  it("stores only the hash and prefix, returns the plaintext once, and audits the source", async () => {
    const issued = await issueClubToken({ clubId: "club-1", source: "register" });

    expect(issued.plaintext).toMatch(/^acs_[0-9a-f]{8}_[0-9a-f]{40}$/);
    expect(parseTokenPrefix(issued.plaintext)).toBe(issued.prefix);

    const stored = create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(hashToken(issued.plaintext));
    expect(stored.tokenPrefix).toBe(issued.prefix);
    expect(JSON.stringify(stored)).not.toContain(issued.plaintext);
    expect(stored.name).toBe("Default key");
    expect(stored.scopes).toContain("sync:read");

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "token.generate",
        clubId: "club-1",
        tokenId: "tok-1",
        metadata: expect.objectContaining({ source: "register" }),
      }),
    );
    expect(JSON.stringify(recordAudit.mock.calls[0][0])).not.toContain(issued.plaintext);
  });

  it("takes the admin's name and scopes when given, through the same validation as the route", async () => {
    const issued = await issueClubToken({
      clubId: "club-1",
      name: "Sync key",
      scopes: ["sync:read"],
      source: "admin",
    });
    expect(issued.name).toBe("Sync key");
    expect(issued.scopes).toEqual(["sync:read"]);
    await expect(
      issueClubToken({ clubId: "club-1", name: "", source: "admin" }),
    ).rejects.toThrow();
  });
});
