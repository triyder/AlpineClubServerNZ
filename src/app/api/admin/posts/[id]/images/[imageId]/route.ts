import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { deleteStoredImage } from "@/lib/uploads";

/**
 * DELETE /api/admin/posts/:id/images/:imageId — remove one image from a post,
 * leaving the text and any other images in place.
 *
 * The common moderation case where a post is fine but one picture is not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { id, imageId } = await params;

  // Scoped to the post in the path so a mistyped id cannot delete an image
  // belonging to a different post.
  const image = await prisma.postImage.findFirst({
    where: { id: imageId, postId: id },
    select: { id: true, storageKey: true },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  // Row first, file second: a crash between them leaves an orphaned file the
  // cleanup sweep reclaims, rather than a row pointing at nothing, which would
  // render as a broken image on every club.
  await prisma.postImage.delete({ where: { id: image.id } });
  const unlinked = await deleteStoredImage(image.storageKey);

  // Touch the post so the mirroring cursor carries the change: the image list
  // is part of the serialised post, and without this bump no club would learn
  // the picture is gone.
  await prisma.post.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  await recordAudit({
    action: "post.image.delete",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { postId: id, imageId, fileUnlinked: unlinked },
  });

  return NextResponse.json({ status: "deleted", fileUnlinked: unlinked });
}
