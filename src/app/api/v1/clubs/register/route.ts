import { NextResponse } from "next/server";
import { clubRegisterSchema } from "@/lib/validation";
import { registerClub } from "@/lib/clubs";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/v1/clubs/register
 *
 * Public endpoint for an external AlpineClubBookingsNZ installation to request
 * linking. Unauthenticated by design (the requester has no token yet), so it is
 * rate-limited by source IP and the created record starts life as PENDING for
 * an admin to review.
 */
export async function POST(req: Request) {
  const ip = clientIp(req) ?? "unknown";
  const rl = checkRateLimit(`register:${ip}`);
  if (!rl.allowed) {
    return rateLimited(rl.resetAt);
  }

  const body = await req.json().catch(() => null);
  const parsed = clubRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid registration payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await registerClub(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await recordAudit({
    action: "club.register",
    clubId: result.club.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: { code: result.club.code, created: result.created, source: "api" },
  });

  return NextResponse.json(
    {
      id: result.club.id,
      code: result.club.code,
      status: result.club.status,
      message:
        "Registration received. An administrator will review your application and issue an API key on approval.",
    },
    { status: result.created ? 201 : 200 },
  );
}

function rateLimited(resetAt: number) {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))),
      },
    },
  );
}
