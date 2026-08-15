import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: () => getSession(),
}));

const findUnique = vi.fn();
const update = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "@/app/api/auth/change-password/route";
import { hashPassword } from "@/lib/auth/password";

function post(body: unknown) {
  return new Request("https://server/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SESSION = { userId: "u1", email: "admin@x.nz", role: "ADMIN" as const };

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    getSession.mockReset();
    findUnique.mockReset();
    update.mockClear();
    auditCreate.mockClear();
  });

  it("rejects an unauthenticated request (401)", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(post({ currentPassword: "x", newPassword: "y".repeat(12) }));
    expect(res.status).toBe(401);
  });

  it("rejects a too-short new password (400)", async () => {
    getSession.mockResolvedValue(SESSION);
    const res = await POST(post({ currentPassword: "old", newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password (400) and audits the failure", async () => {
    getSession.mockResolvedValue(SESSION);
    findUnique.mockResolvedValue({ passwordHash: await hashPassword("Correct-Horse-1") });
    const res = await POST(
      post({ currentPassword: "wrong", newPassword: "Brand-New-Pass-1" }),
    );
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it("rejects reusing the same password (400)", async () => {
    getSession.mockResolvedValue(SESSION);
    findUnique.mockResolvedValue({ passwordHash: await hashPassword("Same-Password-1") });
    const res = await POST(
      post({ currentPassword: "Same-Password-1", newPassword: "Same-Password-1" }),
    );
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("changes the password on valid input (200) and stamps passwordChangedAt", async () => {
    getSession.mockResolvedValue(SESSION);
    findUnique.mockResolvedValue({ passwordHash: await hashPassword("Old-Password-1") });
    const res = await POST(
      post({ currentPassword: "Old-Password-1", newPassword: "Fresh-Password-2" }),
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledOnce();
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "u1" });
    expect(typeof arg.data.passwordHash).toBe("string");
    expect(arg.data.passwordHash).not.toBe("Fresh-Password-2");
    expect(arg.data.passwordChangedAt).toBeInstanceOf(Date);
  });
});
