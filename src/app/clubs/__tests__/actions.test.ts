import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const deleteMany = vi.fn();
const recordAudit = vi.fn();
const requireManager = vi.fn();
const revalidatePath = vi.fn();
const clubFindUnique = vi.fn();
const clubUpdateMany = vi.fn();
const assignRequested = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    apiToken: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
    club: {
      findUnique: (...a: unknown[]) => clubFindUnique(...a),
      updateMany: (...a: unknown[]) => clubUpdateMany(...a),
    },
  },
}));
vi.mock("@/lib/club-lodges", () => ({
  assignRequestedLodgesOnApproval: (...a: unknown[]) => assignRequested(...a),
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
const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));

import {
  approveClubAction,
  approveFromReviewAction,
  deleteRevokedTokenAction,
  reapproveClubAction,
  rejectClubAction,
  suspendClubAction,
} from "../actions";

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

describe("approveClubAction (#40): approval assigns the lodges requested at registration", () => {
  beforeEach(() => {
    clubFindUnique.mockReset();
    clubUpdateMany.mockReset();
    assignRequested.mockReset();
    recordAudit.mockReset();
    revalidatePath.mockReset();
    requireManager.mockReset();
    requireManager.mockResolvedValue({ userId: "user-1", role: "MANAGER" });
    clubUpdateMany.mockResolvedValue({ count: 1 });
  });

  function clubForm(): FormData {
    const fd = new FormData();
    fd.set("clubId", "club-1");
    return fd;
  }

  it("assigns the requested lodges after the status flips, and records what was assigned and skipped", async () => {
    clubFindUnique.mockResolvedValue({ requestedLodgeIds: ["lodge-a", "lodge-b"] });
    assignRequested.mockResolvedValue({ assigned: ["Alpha"], skipped: [{ name: "Beta", reason: "owned", club: "Other" }] });

    await approveClubAction(clubForm());

    expect(clubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "club-1", status: "PENDING" } }),
    );
    expect(assignRequested).toHaveBeenCalledWith("club-1", ["lodge-a", "lodge-b"]);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "club.approve",
        metadata: expect.objectContaining({
          lodgesAssigned: ["Alpha"],
          lodgesSkipped: [{ name: "Beta", reason: "owned", club: "Other" }],
        }),
      }),
    );
  });

  it("assigns nothing when nothing was requested, on a rejection, or when the club was already decided", async () => {
    clubFindUnique.mockResolvedValue({ requestedLodgeIds: [] });
    await approveClubAction(clubForm());
    expect(assignRequested).not.toHaveBeenCalled();

    clubFindUnique.mockResolvedValue({ requestedLodgeIds: ["lodge-a"] });
    await rejectClubAction(clubForm());
    expect(assignRequested).not.toHaveBeenCalled();

    clubUpdateMany.mockResolvedValue({ count: 0 });
    recordAudit.mockClear();
    await approveClubAction(clubForm());
    expect(assignRequested).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("Unapprove and re-approve", () => {
  beforeEach(() => {
    clubFindUnique.mockReset();
    clubUpdateMany.mockReset();
    assignRequested.mockReset();
    recordAudit.mockReset();
    redirect.mockReset();
    requireManager.mockReset();
    requireManager.mockResolvedValue({ userId: "user-1", role: "MANAGER" });
    clubUpdateMany.mockResolvedValue({ count: 1 });
  });

  function clubForm(): FormData {
    const fd = new FormData();
    fd.set("clubId", "club-1");
    return fd;
  }

  it("unapproves only an APPROVED club, guarded in the update itself, and audits it", async () => {
    await suspendClubAction(clubForm());
    expect(clubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "club-1", status: "APPROVED" },
        data: expect.objectContaining({ status: "SUSPENDED", reviewedById: "user-1" }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "club.suspend", clubId: "club-1" }));
  });

  it("re-approves only a SUSPENDED club and does NOT re-run the registration's lodge request", async () => {
    clubFindUnique.mockResolvedValue({ requestedLodgeIds: ["lodge-a"] });
    await reapproveClubAction(clubForm());
    expect(clubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "club-1", status: "SUSPENDED" },
        data: expect.objectContaining({ status: "APPROVED" }),
      }),
    );
    expect(assignRequested).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "club.reapprove" }));
  });

  it("audits nothing when the club was not in the status the move starts from", async () => {
    clubUpdateMany.mockResolvedValue({ count: 0 });
    await suspendClubAction(clubForm());
    await reapproveClubAction(clubForm());
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("requires a manager", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    await expect(suspendClubAction(clubForm())).rejects.toThrow("Not authorized");
    expect(clubUpdateMany).not.toHaveBeenCalled();
  });

  it("the review page's approve is the same guarded approval, then shows the outcome", async () => {
    clubFindUnique.mockResolvedValue({ requestedLodgeIds: [] });
    await approveFromReviewAction(clubForm());
    expect(clubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "club-1", status: "PENDING" } }),
    );
    expect(redirect).toHaveBeenCalledWith("/clubs/review/club-1");
  });
});
