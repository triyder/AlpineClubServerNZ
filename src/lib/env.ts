/**
 * Central, validated access to environment configuration. Reading through
 * these helpers keeps defaults and the ">= 32 char secret" invariant in one
 * place rather than scattered `process.env` reads.
 */

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set and at least 32 characters long.",
    );
  }
  return secret;
}

/**
 * Whether the session cookie carries the `Secure` attribute. Defaults to on in
 * production (cookie sent over HTTPS only). Set SESSION_COOKIE_SECURE=false for
 * plain-HTTP local dev browsing, otherwise the browser drops the cookie over
 * HTTP and login silently fails. Never set it false on a real deployment.
 */
export function sessionCookieSecure(): boolean {
  const override = process.env.SESSION_COOKIE_SECURE?.toLowerCase();
  if (override === "false" || override === "0") return false;
  if (override === "true" || override === "1") return true;
  return process.env.NODE_ENV === "production";
}

export function sessionMaxAgeSeconds(): number {
  const raw = Number(process.env.SESSION_MAX_AGE);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 24 * 7; // 7 days
}

export function rateLimitMax(): number {
  const raw = Number(process.env.RATE_LIMIT_MAX);
  return Number.isFinite(raw) && raw > 0 ? raw : 120;
}

export function rateLimitWindowMs(): number {
  const raw = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

/**
 * Directory holding optimised post images.
 *
 * Deliberately NOT under `public/`: the Dockerfile copies `public/` out of the
 * build stage, so anything written there at runtime is destroyed on the next
 * rebuild, and Next only serves files that were in `public/` at build time.
 * In Docker this path is a named volume (see docker-compose.yml).
 */
export function uploadsDir(): string {
  const dir = process.env.UPLOADS_DIR?.trim();
  if (dir) return dir;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "UPLOADS_DIR must be set in production (mount a persistent volume).",
    );
  }
  return "./data/uploads";
}

/**
 * Absolute origin this server is reached at, used to build image URLs that
 * clients can fetch.
 *
 * Prefers an explicit PUBLIC_BASE_URL; otherwise derives it from the proxy
 * headers Caddy sets. The header path is the normal one for this deployment —
 * DOMAIN varies per install, so hard-coding an origin would be wrong more often
 * than not.
 */
export function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  // Falling back to the request URL keeps this total: a malformed or absent
  // Host header yields a usable origin rather than throwing mid-serialisation.
  if (!host) return new URL(req.url).origin;
  return `${proto}://${host}`;
}
