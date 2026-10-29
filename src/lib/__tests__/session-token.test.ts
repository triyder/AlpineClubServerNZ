import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import {
  readSessionToken,
  refreshedSessionToken,
  SESSION_REFRESH_AFTER_SECONDS,
  signSession,
  verifySession,
} from "@/lib/auth/session-token";

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

  it("records when the user signed in, separate from when the token was issued", async () => {
    const authAt = Math.floor(Date.now() / 1000) - 3600;
    const read = await readSessionToken(
      await signSession({ userId: "u1", email: "a@b.com", role: "ADMIN" }, authAt),
    );
    expect(read?.authAt).toBe(authAt);
    expect(read!.issuedAt).toBeGreaterThan(authAt);
  });

  it("refuses a token past the absolute lifetime, however fresh", async () => {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 3600;
    const token = await signSession({ userId: "u1", email: "a@b.com", role: "ADMIN" }, eightDaysAgo);
    expect(await readSessionToken(token)).toBeNull();
  });
});

describe("refreshedSessionToken (sliding idle timeout)", () => {
  const session = { userId: "u1", email: "a@b.com", role: "ADMIN" as const };

  it("leaves a recently issued token alone", async () => {
    const read = (await readSessionToken(await signSession(session)))!;
    expect(await refreshedSessionToken(read)).toBeNull();
  });

  it("re-issues an older token, keeping the original sign-in time", async () => {
    const read = (await readSessionToken(await signSession(session)))!;
    const later = read.issuedAt + SESSION_REFRESH_AFTER_SECONDS + 1;
    const fresh = await refreshedSessionToken(read, later);
    expect(fresh).not.toBeNull();
    const reread = (await readSessionToken(fresh!))!;
    expect(reread.authAt).toBe(read.authAt);
    expect(reread.session).toEqual(session);
  });
});
