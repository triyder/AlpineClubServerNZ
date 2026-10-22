import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const deleteMany = vi.fn();
const recordAudit = vi.fn();
const requireManager = vi.fn();
const revalidatePath = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
vi.mock("@/lib/admin-guard", () => ({
  requireManager: (...a: unknown[]) => requireManager(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import { deleteRevokedTokenAction } from "../actions";

function form(tokenId: string): FormData {
  const fd = new FormData();
  fd.set("tokenId", tokenId);
  return fd;
}

const REVOKED = {
  id: "tok-1",
  clubId: "club-1",
  name: "Default key",
  tokenPrefix: "acs_0123abcd",
  revokedAt: new Date("2026-10-01T00:00:00.000Z"),
};

describe("deleteRevokedTokenAction (#31)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    deleteMany.mockReset();
    recordAudit.mockReset();
    revalidatePath.mockReset();
    requireManager.mockReset();
    requireManager.mockResolvedValue({ userId: "user-1", role: "MANAGER" });
  });

  it("deletes a REVOKED key, guarded in the delete itself, and writes an audit entry that keeps the key's identity", async () => {
    findUnique.mockResolvedValue(REVOKED);
    deleteMany.mockResolvedValue({ count: 1 });

    await deleteRevokedTokenAction(form("tok-1"));

    // The guard is in the WHERE, so a key revived or re-read between the
    // lookup and the delete cannot be deleted by a stale form.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "tok-1", revokedAt: { not: null } },
    });
    // The token row is gone, so the audit entry cannot reference it by id
    // (the FK nulls); its prefix, name and club live in the metadata instead.
    expect(recordAudit).toHaveBeenCalledWith({
      action: "token.delete",
      clubId: "club-1",
      userId: "user-1",
      metadata: {
        tokenId: "tok-1",
        name: "Default key",
        prefix: "acs_0123abcd",
        revokedAt: "2026-10-01T00:00:00.000Z",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/clubs");
  });

  it("never deletes a LIVE key: the delete's own filter refuses it and nothing is audited", async () => {
    findUnique.mockResolvedValue({ ...REVOKED, revokedAt: null });
    deleteMany.mockResolvedValue({ count: 0 });

    await deleteRevokedTokenAction(form("tok-1"));

    expect(deleteMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("audits nothing when the key was already gone", async () => {
    findUnique.mockResolvedValue(null);

    await deleteRevokedTokenAction(form("tok-1"));

    expect(deleteMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/clubs");
  });

  it("requires a manager before touching anything", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));

    await expect(deleteRevokedTokenAction(form("tok-1"))).rejects.toThrow("Not authorized");
    expect(findUnique).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
