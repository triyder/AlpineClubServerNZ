import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { dismissReports } from "@/lib/post-admin";

/**
 * POST /api/admin/posts/:id/dismiss — clear the open reports, leave visibility
 * alone.
 *
 * For a post that is being reported but has not been hidden: the admin has
 * looked and judged the reports unfounded. Use /unhide for a post that is
 * already hidden — that clears the hide as well.
 *
 * Dismissal stamps `dismissedAt` rather than deleting the rows, so the history
 * stays visible to the next admin and the post remains re-reportable by a fresh
 * set of members.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const existing = await prisma.post.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const dismissed = await dismissReports(id);

  await recordAudit({
    action: "post.dismiss",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { postId: id, reportsDismissed: dismissed },
  });

  return NextResponse.json({ reportsDismissed: dismissed });
}
