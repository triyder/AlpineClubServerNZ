import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { deleteStoredImage } from "@/lib/uploads";
import {
  imageRenameSchema,
  imageSelect,
  serializeImage,
} from "@/lib/image-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/images/:id — rename a picture (its type is fixed). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = imageRenameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.image.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const updated = await prisma.image.update({
    where: { id },
    data: { name: parsed.data.name },
    select: imageSelect,
  });

  await recordAudit({
    action: "image.rename",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    userId: session.userId,
    metadata: { id },
  });

  return NextResponse.json({ image: serializeImage(updated) });
}

/**
 * DELETE /api/admin/images/:id — remove a picture and its file.
 *
 * Refused (409, naming the lodges) while a lodge is using it: silently blanking a
 * lodge's picture is not something an administrator asked for by tidying the
 * library. The foreign keys are SET NULL as the backstop for the race where a
 * lodge picks the picture between this check and the delete.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.image.findUnique({
    where: { id },
    select: { ...imageSelect, storageKey: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const { usedBy } = serializeImage(existing);
  if (usedBy.length > 0) {
    return NextResponse.json(
      {
        error: `This picture is used by ${usedBy.join(", ")}. Choose a different picture for ${
          usedBy.length === 1 ? "that lodge" : "those lodges"
        } first.`,
        lodges: usedBy,
      },
      { status: 409 },
    );
  }

  // Row first, file second: a crash between the two leaves an orphan file (the
  // harmless direction) and never a row pointing at nothing.
  await prisma.image.delete({ where: { id } });
  await deleteStoredImage(existing.storageKey).catch((err) =>
    logger.error({ err, id }, "failed to remove library image file"),
  );

  await recordAudit({
    action: "image.delete",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    userId: session.userId,
    metadata: { id, name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
