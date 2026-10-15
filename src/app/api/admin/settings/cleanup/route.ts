import { NextResponse } from "next/server";
import { guardAdminWrite } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { runPostCleanup } from "@/lib/post-cleanup";

/**
 * POST /api/admin/settings/cleanup — run the retention pass now.
 *
 * The same function the 02:00 UTC cron calls. The job takes a single-flight
 * claim, so pressing this while the scheduled pass is running returns
 * `skipped: "already-running"` rather than doing the work twice.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await guardAdminWrite(req, "admin");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const stats = await runPostCleanup({ trigger: "manual" });

  await recordAudit({
    action: "posts.cleanup",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { ...stats, trigger: "manual" },
  });

  return NextResponse.json({ stats });
}
