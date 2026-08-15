import "server-only";
import { cookies } from "next/headers";
import { sessionCookieSecure, sessionMaxAgeSeconds } from "@/lib/env";
import {
  SESSION_COOKIE,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth/session-token";

export { SESSION_COOKIE, type SessionPayload };

/** Sign the payload and write it to the httpOnly session cookie. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds(),
  });
}

/** Read and verify the current session from the request cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Clear the session cookie (logout). */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
