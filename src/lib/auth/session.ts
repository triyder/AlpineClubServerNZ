import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE,
  readSessionToken,
  sessionCookieOptions,
  signSession,
  type SessionPayload,
} from "@/lib/auth/session-token";

export { SESSION_COOKIE, type SessionPayload };

/** Sign the payload and write it to the httpOnly session cookie. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * Read and verify the current session from the request cookies.
 *
 * The signature alone is not enough: the token lives for days, so it is also
 * checked against the user's row. A deleted user has no session, a token made
 * before the user's last password change is void (so changing a password
 * signs out every other browser), and the ROLE comes from the database, not
 * the token, so a demotion takes effect on the next request.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const read = await readSessionToken(token);
  if (!read) return null;

  const user = await prisma.user.findUnique({
    where: { id: read.session.userId },
    select: { email: true, role: true, passwordChangedAt: true },
  });
  if (!user) return null;
  // Against the SIGN-IN time, not the token's: the proxy re-issues tokens
  // while the console is in use, and a refresh must not outlive a change.
  if (user.passwordChangedAt && read.authAt < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    return null;
  }
  return { userId: read.session.userId, email: user.email, role: user.role };
}

/** Clear the session cookie (logout). */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
