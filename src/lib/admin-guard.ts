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
