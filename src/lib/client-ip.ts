/**
 * The caller's address, as the reverse proxy reports it. Pure (no database),
 * so server actions and pages can use it without pulling in Prisma.
 *
 * Caddy sets BOTH headers to `{client_ip}`, resolved through its
 * `trusted_proxies` (see Caddyfile): a value a visitor sends is overwritten,
 * so the first entry here is the address Caddy vouched for.
 */

/** Best-effort client IP from proxy headers (Caddy sets X-Forwarded-For). */
export function clientIp(req: Request): string | null {
  return clientIpFromHeaders(req.headers);
}

/** `clientIp` for a page, which has the request's headers but no `Request`. */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip");
}
