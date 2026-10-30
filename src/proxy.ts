import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  readSessionToken,
  refreshedSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session-token";

/**
 * Next.js proxy (formerly "middleware"). Two jobs, on every page:
 *
 *  1. CONTENT SECURITY POLICY with a fresh nonce per request. Next reads the
 *     nonce from the request's CSP header and stamps it on its own scripts,
 *     so only scripts this server rendered run; an injected `<script>` has no
 *     nonce and is refused.
 *  2. THE SESSION GATE for the console. A stateless JWT signature/expiry check
 *     (jose) — no DB access. Pages and route handlers still re-check the
 *     session against the database (`getSession`); this is a first gate that
 *     keeps signed-out visitors off the console entirely. While the console is
 *     in use the token is re-issued, so `SESSION_MAX_AGE` is an idle timeout.
 *
 * The `/api/*` routes authenticate themselves (bearer token or session) and
 * serve no HTML, so they are deliberately NOT matched.
 */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/clubs",
  "/lodges",
  "/issues",
  "/admin",
  "/audit",
  "/profile",
  "/posts",
  "/settings",
];

/** The policy for one response; `nonce` is fresh per request. */
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets a nonced script load the chunks it needs; in dev,
    // React Refresh also needs eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style ATTRIBUTES cannot carry a nonce, and React writes them.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const token = isProtected ? req.cookies.get(SESSION_COOKIE)?.value : undefined;
  const read = token ? await readSessionToken(token) : null;

  if (isProtected && !read) {
    // Remember where they were going (the review link in a new-club email), so
    // sign-in can return there. The login action re-checks it (safeNextPath).
    const login = new URL("/login", req.url);
    if (pathname !== "/dashboard") login.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    const res = NextResponse.redirect(login);
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  if (read) {
    const fresh = await refreshedSessionToken(read);
    if (fresh) res.cookies.set(SESSION_COOKIE, fresh, sessionCookieOptions());
  }
  return res;
}

export const config = {
  // Every page (for the CSP nonce); the session gate inside applies only to
  // PROTECTED_PREFIXES. Static assets and the API are skipped.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
