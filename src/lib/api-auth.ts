import "server-only";
import type { ApiToken, Club } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseTokenPrefix, tokenMatchesHash } from "@/lib/api-tokens";

export interface AuthenticatedClient {
  club: Club;
  token: ApiToken;
}

export type ApiAuthResult =
  | { ok: true; client: AuthenticatedClient }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Extract a bearer token from an incoming request. Accepts either the standard
 * `Authorization: Bearer <token>` header or a custom `X-API-Key: <token>`
 * header (used by some AlpineClubBookingsNZ client configurations).
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return apiKey.trim();
  return null;
}

/** Best-effort client IP from proxy headers (Caddy sets X-Forwarded-For). */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

/**
 * Authenticate a client application request against the API token store.
 *
 * Steps: parse the non-secret prefix, look the token up by that indexed
 * column, verify the presented secret against the stored SHA-256 hash in
 * constant time, and reject revoked tokens or tokens whose club is not
 * APPROVED. On success `lastUsedAt` is stamped.
 */
export async function authenticateApiRequest(
  req: Request,
): Promise<ApiAuthResult> {
  const presented = extractBearerToken(req);
  if (!presented) {
    return { ok: false, status: 401, error: "Missing API token" };
  }

  const prefix = parseTokenPrefix(presented);
  if (!prefix) {
    return { ok: false, status: 401, error: "Malformed API token" };
  }

  const token = await prisma.apiToken.findFirst({
    where: { tokenPrefix: prefix },
    include: { club: true },
  });

  // Same generic 401 whether the prefix is unknown or the secret is wrong, so
  // an attacker cannot distinguish "valid prefix" from "invalid prefix".
  if (!token || !tokenMatchesHash(presented, token.tokenHash)) {
    return { ok: false, status: 401, error: "Invalid API token" };
  }

  if (token.revokedAt) {
    return { ok: false, status: 403, error: "API token has been revoked" };
  }

  if (token.club.status !== "APPROVED") {
    return { ok: false, status: 403, error: "Club is not approved" };
  }

  // Fire-and-forget last-used stamp; not critical to the request outcome.
  void prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const { club, ...tokenOnly } = token;
  return { ok: true, client: { club, token: tokenOnly } };
}

/** True if the token's scopes grant the required scope (or "*" wildcard). */
export function hasScope(token: ApiToken, required: string): boolean {
  return token.scopes.includes("*") || token.scopes.includes(required);
}
