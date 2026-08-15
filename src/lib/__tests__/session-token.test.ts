import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signSession, verifySession } from "@/lib/auth/session-token";

const secret = () =>
  new TextEncoder().encode(process.env.SESSION_SECRET as string);

describe("session-token", () => {
  it("round-trips a signed session payload", async () => {
    const token = await signSession({
      userId: "u1",
      email: "a@b.com",
      role: "ADMIN",
    });
    const payload = await verifySession(token);
    expect(payload).toEqual({ userId: "u1", email: "a@b.com", role: "ADMIN" });
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({
      userId: "u1",
      email: "a@b.com",
      role: "USER",
    });
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const foreign = await new SignJWT({
      userId: "u1",
      email: "a@b.com",
      role: "ADMIN",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-different-secret-at-least-32-chars!!"));
    expect(await verifySession(foreign)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({
      userId: "u1",
      email: "a@b.com",
      role: "USER",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret());
    expect(await verifySession(expired)).toBeNull();
  });

  it("returns null for a non-token string", async () => {
    expect(await verifySession("garbage")).toBeNull();
  });
});
