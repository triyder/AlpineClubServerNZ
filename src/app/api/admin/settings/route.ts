import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import {
  loadPostSettings,
  postSettingsSchema,
  savePostSettings,
} from "@/lib/settings";

/**
 * GET|PUT /api/admin/settings — the Communication Portal tunables.
 *
 * ADMIN only: these govern how long member content lives and how easily it is
 * hidden across the whole network.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return NextResponse.json({ settings: await loadPostSettings() });
}

export async function PUT(req: Request) {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = postSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Capture the previous values: changing retention silently destroys member
  // content on a schedule, so what it was before needs to stay recoverable.
  const before = await loadPostSettings();
  await savePostSettings(parsed.data);

  await recordAudit({
    action: "settings.update",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    // Widened to a plain record: PostSettings is an interface, and Prisma's
    // InputJsonValue requires an index signature. Every field is a number,
    // so nothing is lost.
    metadata: {
      before: { ...before } as Record<string, number>,
      after: { ...parsed.data } as Record<string, number>,
    },
  });

  return NextResponse.json({ settings: parsed.data });
}
