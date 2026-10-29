import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

const findUnique = vi.fn();
let cookieValue: string | undefined;

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

import { getSession } from "@/lib/auth/session";

const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET as string);

/** A session token issued `secondsAgo` seconds ago, claiming `role`. */
function tokenIssued(secondsAgo: number, role = "ADMIN"): Promise<string> {
  const iat = Math.floor(Date.now() / 1000) - secondsAgo;
  return new SignJWT({ userId: "u1", email: "old@x.nz", role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret());
}

describe("getSession checks the token against the user's row", () => {
  beforeEach(() => {
    findUnique.mockReset();
    cookieValue = undefined;
  });

  it("has no session without a cookie, and never queries", async () => {
    expect(await getSession()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("has no session when the user no longer exists", async () => {
    cookieValue = await tokenIssued(60);
    findUnique.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });

  it("voids a token issued before the user's last password change", async () => {
    cookieValue = await tokenIssued(600);
    findUnique.mockResolvedValue({
      email: "old@x.nz",
      role: "ADMIN",
      passwordChangedAt: new Date(Date.now() - 60_000),
    });
    expect(await getSession()).toBeNull();
  });

  it("keeps a token issued after the change", async () => {
    cookieValue = await tokenIssued(10);
    findUnique.mockResolvedValue({
      email: "old@x.nz",
      role: "ADMIN",
      passwordChangedAt: new Date(Date.now() - 60_000),
    });
    expect(await getSession()).toEqual({ userId: "u1", email: "old@x.nz", role: "ADMIN" });
  });

  it("takes the role and email from the database, not the token", async () => {
    cookieValue = await tokenIssued(10, "ADMIN");
    findUnique.mockResolvedValue({ email: "new@x.nz", role: "USER", passwordChangedAt: null });
    expect(await getSession()).toEqual({ userId: "u1", email: "new@x.nz", role: "USER" });
  });
});
