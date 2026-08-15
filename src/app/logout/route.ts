import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-token";

/**
 * POST /logout — clear the session cookie and return to the login page.
 *
 * Uses a RELATIVE `Location: /login` rather than `NextResponse.redirect(new
 * URL("/login", req.url))`. Behind the reverse proxy the Next standalone server
 * reconstructs `req.url` from its own bind address + the forwarded proto, so an
 * absolute redirect leaks the internal origin (e.g. `https://0.0.0.0:3000`).
 * A relative Location is resolved by the browser against whatever origin it is
 * actually on (localhost:3100 in dev, the real domain in prod), so it works on
 * every surface without trusting proxy headers.
 */
export async function POST() {
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/login" },
  });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
