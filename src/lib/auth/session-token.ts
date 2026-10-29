import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import {
  sessionAbsoluteMaxAgeSeconds,
  sessionCookieSecure,
  sessionMaxAgeSeconds,
  sessionSecret,
} from "@/lib/env";

export const SESSION_COOKIE = "acs_session";

export interface SessionPayload {
  userId: string;
  email: string;
  role: Role;
}

/** A verified token: who, when it was issued, and when that user signed in. */
export interface ReadSession {
  session: SessionPayload;
  /** When this token was issued (Unix seconds). Moves on every refresh. */
  issuedAt: number;
  /** When the user typed their password (Unix seconds). Never moves. */
  authAt: number;
}

/**
 * Refresh a token once it is this old (seconds), so an active console stays
 * signed in while an idle one expires after `SESSION_MAX_AGE`.
 */
export const SESSION_REFRESH_AFTER_SECONDS = 10 * 60;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(sessionSecret());
}

/**
 * Sign a session payload into a signed JWT (HS256). Pure and runtime-agnostic
 * (no cookies / no `server-only`), so it is safe to unit-test and to use from
 * both the Node server and the proxy.
 *
 * `authAt` is when the user signed in; a refresh passes the original one on,
 * so a password change (compared against it) and the absolute lifetime both
 * still apply to a refreshed token.
 */
export async function signSession(
  payload: SessionPayload,
  authAt: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ ...payload, authAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeSeconds()}s`)
    .sign(secretKey());
}

/** Verify a JWT and return its payload, or null if invalid/expired. Pure. */
export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  return (await readSessionToken(token))?.session ?? null;
}

/**
 * `verifySession` plus when the token was issued and when the user signed in
 * (Unix seconds). The Node side compares `authAt` with the user's
 * `passwordChangedAt`, so a password change ends every session made before it.
 * A token past the absolute lifetime (`SESSION_ABSOLUTE_MAX_AGE` since sign-in)
 * is refused however recently it was refreshed.
 */
export async function readSessionToken(token: string): Promise<ReadSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.userId === "string" &&
      typeof payload.email === "string" &&
      typeof payload.role === "string" &&
      typeof payload.iat === "number"
    ) {
      // A token from before `authAt` existed signed in when it was issued.
      const authAt = typeof payload.authAt === "number" ? payload.authAt : payload.iat;
      if (Math.floor(Date.now() / 1000) - authAt > sessionAbsoluteMaxAgeSeconds()) {
        return null;
      }
      return {
        session: {
          userId: payload.userId,
          email: payload.email,
          role: payload.role as Role,
        },
        issuedAt: payload.iat,
        authAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A fresh token for a read one, or null when it is not yet due a refresh.
 * Carries the original sign-in time forward (see `signSession`).
 */
export async function refreshedSessionToken(
  read: ReadSession,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (now - read.issuedAt < SESSION_REFRESH_AFTER_SECONDS) return null;
  return signSession(read.session, read.authAt);
}

/** The session cookie's attributes, shared by sign-in and the proxy's refresh. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
  };
}
