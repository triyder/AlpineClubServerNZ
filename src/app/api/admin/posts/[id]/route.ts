import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { removePost } from "@/lib/post-removal";
import {
  normalizePostContent,
  POST_CONTENT_MAX,
  postSelect,
  serializePostForAdmin,
} from "@/lib/posts";
import { publicBaseUrl } from "@/lib/env";

/**
 * PATCH /api/admin/posts/:id — hide, unhide-adjacent edits, and text edits.
 * DELETE /api/admin/posts/:id — remove from the network.
 *
 * ADMIN only. Moderating this feed means editing and permanently removing other
 * clubs' members' content, so it is not delegated to the manager tier that
 * reviews clubs and issues tokens.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    // Setting hidden=true is an admin hide; false is handled by /unhide, which
    // also clears the reports that caused it.
    hidden: z.boolean().optional(),
    content: z.string().max(POST_CONTENT_MAX).optional(),
    autoHideExempt: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "No changes supplied",
  });

export async function PATCH(
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
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.post.findUnique({
    where: { id },
    select: { id: true, content: true, removedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (existing.removedAt) {
    // A stub has no content and no images; editing one would write text that
    // no client will ever be sent, since sync reports it as removed.
    return NextResponse.json(
      { error: "Post has been removed and can no longer be edited" },
      { status: 409 },
    );
  }

  const data: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};

  if (parsed.data.hidden !== undefined) {
    data.hiddenAt = parsed.data.hidden ? new Date() : null;
    data.hiddenBy = parsed.data.hidden ? "ADMIN" : null;
    changes.hidden = parsed.data.hidden;
  }

  if (parsed.data.content !== undefined) {
    const content = normalizePostContent(parsed.data.content);
    if (content.length === 0) {
      return NextResponse.json(
        { error: "Post content is empty" },
        { status: 400 },
      );
    }
    data.content = content;
    // The original goes into the audit metadata: an admin edit rewrites another
    // club's member's words, so what it replaced has to remain recoverable.
    changes.contentBefore = existing.content;
    changes.contentAfter = content;
  }

  if (parsed.data.autoHideExempt !== undefined) {
    data.autoHideExempt = parsed.data.autoHideExempt;
    changes.autoHideExempt = parsed.data.autoHideExempt;
  }

  const updated = await prisma.post.update({
    where: { id },
    data,
    select: postSelect,
  });

  await recordAudit({
    action: parsed.data.content !== undefined ? "post.edit" : "post.hide",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { postId: id, ...changes },
  });

  return NextResponse.json({
    post: serializePostForAdmin(updated, publicBaseUrl(req)),
  });
}

export async function DELETE(
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
  const result = await removePost(id, "ADMIN");

  if (result === null) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  await recordAudit({
    action: "post.remove",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: {
      postId: id,
      alreadyRemoved: !result.removed,
      imagesDeleted: result.imagesDeleted,
      filesUnlinked: result.filesUnlinked,
    },
  });

  return NextResponse.json({
    status: result.removed ? "removed" : "already-removed",
    imagesDeleted: result.imagesDeleted,
  });
}
