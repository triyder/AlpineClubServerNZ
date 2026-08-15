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
