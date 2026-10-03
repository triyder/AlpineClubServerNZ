import { describe, it, expect, vi, beforeEach } from "vitest";

const requireManager = vi.fn();
vi.mock("@/lib/admin-guard", () => ({
  requireManager: (...a: unknown[]) => requireManager(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const updateMany = vi.fn();
const findUnique = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    syncIssue: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { clearIssueAction } from "../actions";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue({ userId: "user_1", role: "ADMIN" });
  updateMany.mockReset();
  findUnique.mockReset().mockResolvedValue({ clubId: "club_1", kind: "VERSION_MISMATCH" });
  auditCreate.mockReset().mockResolvedValue({});
});

describe("clearIssueAction", () => {
  it("refuses a caller who is not a manager and changes nothing", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    await expect(clearIssueAction(form({ issueId: "i1" }))).rejects.toThrow("Not authorized");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("clears only an OPEN issue, frees the open key, and records who and when", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await clearIssueAction(form({ issueId: "i1", note: "  club upgraded  " }));

    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "i1", status: "OPEN" });
    expect(arg.data).toMatchObject({
      status: "CLEARED",
      openKey: null,
      clearedById: "user_1",
      note: "club upgraded",
    });
    expect(arg.data.clearedAt).toBeInstanceOf(Date);

    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe("issue.cleared");
    expect(audit.clubId).toBe("club_1");
    expect(audit.userId).toBe("user_1");
  });

  it("does not audit when the issue was already cleared (double submit)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await clearIssueAction(form({ issueId: "i1" }));
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("stores a blank note as null and bounds a long one", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await clearIssueAction(form({ issueId: "i1", note: "   " }));
    expect(updateMany.mock.calls[0][0].data.note).toBeNull();

    await clearIssueAction(form({ issueId: "i1", note: "x".repeat(900) }));
    expect(updateMany.mock.calls[1][0].data.note).toHaveLength(500);
  });

  it("does nothing without an issue id", async () => {
    await clearIssueAction(form({}));
    expect(updateMany).not.toHaveBeenCalled();
  });
});
