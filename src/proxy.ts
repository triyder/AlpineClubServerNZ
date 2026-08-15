import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session-token";

/**
 * Next.js proxy (formerly "middleware"). Gate the authenticated web console.
 * Runs on the Edge runtime, so it only does
 * a stateless JWT signature/expiry check (jose) — no DB access. Route handlers
 * still re-check role/authorization server-side; this is a first gate that
 * keeps unauthenticated users off the dashboard entirely.
 *
 * The `/api/v1/*` client API authenticates via bearer token inside each route
 * handler and is deliberately NOT matched here.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/clubs", "/lodges", "/profile"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/clubs/:path*",
    "/lodges/:path*",
    "/profile/:path*",
  ],
};
