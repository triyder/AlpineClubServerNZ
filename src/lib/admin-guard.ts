import "server-only";
import { getSession } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/session-token";

/**
 * Assert an authenticated session with sufficient privilege for admin actions.
 * ADMIN and MANAGER may review clubs and issue tokens; plain USER may not.
 * Throws on failure — callers are server actions / route handlers that treat a
 * throw as "not authorized".
 */
export async function requireManager(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "MANAGER")) {
    throw new Error("Not authorized");
  }
  return session;
}

/**
 * Assert an authenticated ADMIN session — stricter than `requireManager`, which
 * also admits MANAGER.
 *
 * The Communication Portal is admin-only: moderating the cross-club feed means
 * editing and permanently removing other clubs' members' content, so it is not
 * delegated to the manager tier that reviews clubs and issues tokens.
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    throw new Error("Not authorized");
  }
  return session;
}
