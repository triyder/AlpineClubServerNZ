import { NextResponse } from "next/server";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { syncSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

/**
 * POST /api/v1/sync
 *
 * Authenticated sync endpoint for a linked booking engine. Requires a valid,
 * non-revoked API token belonging to an APPROVED club. Rate-limited per token.
 *
 * This scaffold acknowledges the pushed batch and returns a server cursor; the
 * concrete reconciliation of booking records is intentionally left as the
 * integration point for the AlpineClubBookingsNZ sync protocol.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    await recordAudit({
      action: "sync",
      outcome: "FAILURE",
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
      metadata: { reason: auth.error },
    });
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { club, token } = auth.client;

  // Per-token rate limiting.
  const rl = checkRateLimit(`sync:${token.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(0, Math.ceil((rl.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  if (!hasScope(token, "sync:write") && !hasScope(token, "sync:read")) {
    return NextResponse.json(
      { error: "Token lacks sync scope" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = syncSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid sync payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const accepted = parsed.data.records.length;
  const serverCursor = new Date().toISOString();

  await recordAudit({
    action: "sync",
    outcome: "SUCCESS",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: { accepted, since: parsed.data.since ?? null },
  });

  return NextResponse.json({
    club: { id: club.id, code: club.code },
    accepted,
    cursor: serverCursor,
    // No downstream records to hand back in the scaffold.
    records: [],
  });
}
