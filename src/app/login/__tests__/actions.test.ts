import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const createSession = vi.fn();
const recordAudit = vi.fn();
const verifyPassword = vi.fn();
const hashPassword = vi.fn();
let requestHeaders = new Headers();

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));
vi.mock("@/lib/auth/session", () => ({
  createSession: (...a: unknown[]) => createSession(...a),
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: (...a: unknown[]) => verifyPassword(...a),
  hashPassword: (...a: unknown[]) => hashPassword(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { loginAction } from "../actions";
import { resetRateLimits } from "@/lib/rate-limit";

function form(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

const REAL_HASH = "$2b$12$" + "a".repeat(53);

describe("loginAction: brute-force and enumeration hardening", () => {
  beforeEach(() => {
    resetRateLimits();
    findUnique.mockReset();
    createSession.mockReset();
    recordAudit.mockReset();
    verifyPassword.mockReset().mockResolvedValue(false);
    hashPassword.mockReset().mockResolvedValue(REAL_HASH);
    requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7" });
  });

  it("checks an unknown email against a well-formed bcrypt hash, so it costs as much as a real one", async () => {
    findUnique.mockResolvedValue(null);
    const state = await loginAction({}, form("nobody@example.nz", "guess"));
    expect(state.error).toBe("Invalid email or password.");
    const usedHash = verifyPassword.mock.calls[0]![1] as string;
    expect(usedHash).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
  });

  it("stops trying one account after 10 attempts in the window, before computing a hash", async () => {
    findUnique.mockResolvedValue({ id: "u1", email: "admin@example.nz", role: "ADMIN", passwordHash: REAL_HASH });
    for (let i = 0; i < 10; i++) {
      requestHeaders = new Headers({ "x-forwarded-for": `198.51.100.${i}` });
      await loginAction({}, form("admin@example.nz", `wrong-${i}`));
    }
    verifyPassword.mockClear();
    requestHeaders = new Headers({ "x-forwarded-for": "198.51.100.99" });
    const state = await loginAction({}, form("admin@example.nz", "another"));
    expect(state.error).toMatch(/Too many sign-in attempts/);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("stops one caller address after 20 attempts across any accounts", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 20; i++) {
      await loginAction({}, form(`user${i}@example.nz`, "guess"));
    }
    const state = await loginAction({}, form("fresh@example.nz", "guess"));
    expect(state.error).toMatch(/Too many sign-in attempts/);
  });

  it("records the caller's address on a failed sign-in", async () => {
    findUnique.mockResolvedValue(null);
    await loginAction({}, form("nobody@example.nz", "guess"));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "FAILURE", ipAddress: "203.0.113.7" }),
    );
  });

  it("still signs a correct password in", async () => {
    findUnique.mockResolvedValue({ id: "u1", email: "admin@example.nz", role: "ADMIN", passwordHash: REAL_HASH });
    verifyPassword.mockResolvedValue(true);
    await expect(loginAction({}, form("admin@example.nz", "right"))).rejects.toThrow("REDIRECT /dashboard");
    expect(createSession).toHaveBeenCalledWith({ userId: "u1", email: "admin@example.nz", role: "ADMIN" });
  });
});
