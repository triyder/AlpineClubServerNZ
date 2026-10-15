import "server-only";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/session-token";
import { publicBaseUrl } from "@/lib/env";

/**
 * Assert an authenticated session with sufficient privilege for admin actions.
 * ADMIN and MANAGER may review clubs and issue tokens; plain USER may not.
 * Throws on failure. For SERVER ACTIONS only (Next.js checks their origin);
 * an admin API route uses `guardAdminWrite` or `guardAdminSession` below.
 */
export async function requireManager(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "MANAGER")) {
    throw new Error("Not authorized");
  }
  return session;
}

/** Who an admin API route admits: ADMIN and MANAGER, or ADMIN alone. */
export type AdminLevel = "manager" | "admin";

export type AdminGuardResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

const ROLES: Record<AdminLevel, ReadonlyArray<SessionPayload["role"]>> = {
  manager: ["ADMIN", "MANAGER"],
  admin: ["ADMIN"],
};

/**
 * The session check every admin API route makes (#13): no session is `401`,
 * a signed-in user without the role is `403` (not `401`: they are signed in,
 * and the answer must not send them to sign in again).
 */
export async function guardAdminSession(level: AdminLevel): Promise<AdminGuardResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (!ROLES[level].includes(session.role)) {
    return { ok: false, response: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { ok: true, session };
}

/**
 * The check EVERY state-changing admin API handler (POST, PUT, PATCH, DELETE)
 * makes first (#13), before it reads its body or the database. The session
 * cookie is `SameSite=Lax`, which stops ordinary cross-site requests but not
 * one from a sibling subdomain (same SITE, different ORIGIN), and Next.js
 * guards server actions only. So:
 *
 *  - a request carrying an `Origin` that is not this server's own (as
 *    `publicBaseUrl` gives it) is refused, `403`;
 *  - a browser request whose `Sec-Fetch-Site` says it came from anywhere but
 *    this origin (`same-site` included) is refused, `403`, for the browser
 *    that sends that header but no `Origin`;
 *  - a JSON route (the default) refuses a body sent as anything but
 *    `application/json` (`415`): a form or `text/plain` post is exactly what
 *    another page can send without asking first. A multipart route (the image
 *    upload) passes `body: "multipart"` and relies on the origin checks;
 *  - then the session: `401` without one, `403` without the role.
 *
 * A request with neither `Origin` nor `Sec-Fetch-Site` (a non-browser client)
 * is not refused for it: it cannot ride a browser's cookie. The census test
 * `admin-write-guard-census.test.ts` fails when a write handler skips this.
 */
export async function guardAdminWrite(
  req: Request,
  level: AdminLevel,
  options: { body?: "json" | "multipart" } = {},
): Promise<AdminGuardResult> {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  let own: string;
  try {
    own = new URL(publicBaseUrl(req)).origin;
  } catch {
    // A PUBLIC_BASE_URL with no scheme, or a forwarded host that is not a
    // host: this server cannot say what its own origin is, so it refuses the
    // write with a reason an operator can act on, rather than a bare 500.
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This server's own address is misconfigured (PUBLIC_BASE_URL or the proxy's forwarded host), so admin changes are refused until it is fixed." },
        { status: 500 },
      ),
    };
  }
  if ((origin !== null && origin !== own) || (site !== null && site !== "same-origin" && site !== "none")) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "This request did not come from this console. Open the console at its usual address and try again.",
          code: "CROSS_ORIGIN",
        },
        { status: 403 },
      ),
    };
  }
  const contentType = req.headers.get("content-type");
  const jsonBody = (options.body ?? "json") === "json";
  if (jsonBody && contentType !== null && !/^application\/json\s*(;|$)/i.test(contentType.trim())) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Send the request body as application/json." }, { status: 415 }),
    };
  }
  return guardAdminSession(level);
}
