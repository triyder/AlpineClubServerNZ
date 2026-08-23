import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { dismissReports } from "@/lib/post-admin";

/**
 * POST /api/admin/posts/:id/unhide — override a hide and put the post back.
 *
 * Unhiding alone would not be enough. The reports that triggered the auto-hide
 * are still open, so the very next report would recount past the threshold and
 * hide it again immediately. This therefore does three things together:
 * clears the hide, dismisses the open reports, and resets the cached count.
 *
 * `exempt: true` additionally sets `autoHideExempt`, which is what an admin uses
 * for a post being deliberately targeted: without it, three fresh reports
 * re-hide the post and the cycle repeats indefinitely.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ exempt: z.boolean().optional() })
  .strict()
  .optional();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { id } = await params;
  const raw = await req.json().catch(() => undefined);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const exempt = parsed.data?.exempt ?? false;

  const existing = await prisma.post.findUnique({
    where: { id },
    select: { id: true, removedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (existing.removedAt) {
    return NextResponse.json(
      { error: "Post has been removed and cannot be restored" },
      { status: 409 },
    );
  }

  const dismissed = await dismissReports(id);

  await prisma.post.update({
    where: { id },
    data: {
      hiddenAt: null,
      hiddenBy: null,
      ...(exempt ? { autoHideExempt: true } : {}),
    },
  });

  await recordAudit({
    action: exempt ? "post.exempt" : "post.unhide",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { postId: id, reportsDismissed: dismissed, exempt },
  });

  return NextResponse.json({ status: "visible", reportsDismissed: dismissed, exempt });
}
