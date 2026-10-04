import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import {
  assertBatchWithinLimits,
  deleteStoredImage,
  ImageRejectedError,
  LIBRARY_IMAGE_PROFILE,
  LIBRARY_LOGO_PROFILE,
  LIBRARY_MAX_FILES,
  writeProcessedImage,
} from "@/lib/uploads";
import {
  imageNameFromFilename,
  imageSelect,
  isImageKind,
  serializeImage,
} from "@/lib/image-library";

// Reads and writes the filesystem and the database.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/images?kind=IMAGE|LOGO — the library, newest first. */
export async function GET(req: Request) {
  try {
    await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const kindParam = new URL(req.url).searchParams.get("kind");
  if (kindParam !== null && !isImageKind(kindParam)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const images = await prisma.image.findMany({
    where: kindParam ? { kind: kindParam } : {},
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: imageSelect,
  });
  return NextResponse.json({ images: images.map(serializeImage) });
}

/**
 * POST /api/admin/images — upload one or more pictures (multipart).
 *
 * Fields: `kind` (`IMAGE` or `LOGO`) and `files` (repeatable). Every file is
 * magic-byte checked, decoded within a pixel ceiling, resized, stripped of its
 * metadata and stored as WebP; the original is never kept. A file that fails is
 * reported and the rest still go in, so one bad file does not lose a batch.
 */
export async function POST(req: Request) {
  let session;
  try {
    session = await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const kind = form.get("kind");
  if (!isImageKind(kind)) {
    return NextResponse.json(
      { error: "Choose whether this is a lodge image or a logo." },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
  }

  // Sized from the declared lengths before anything is decoded, so an oversized
  // request is refused cheaply.
  try {
    assertBatchWithinLimits(
      files.map((f) => f.size),
      LIBRARY_MAX_FILES,
      "One upload",
    );
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }

  const profile = kind === "LOGO" ? LIBRARY_LOGO_PROFILE : LIBRARY_IMAGE_PROFILE;
  const created = [];
  const rejected: Array<{ filename: string; error: string }> = [];

  for (const file of files) {
    const filename = file.name || "image";
    let stored;
    try {
      stored = await writeProcessedImage(
        Buffer.from(await file.arrayBuffer()),
        new Date(),
        profile,
      );
    } catch (error) {
      if (error instanceof ImageRejectedError) {
        rejected.push({ filename, error: error.message });
        continue;
      }
      throw error;
    }

    try {
      const row = await prisma.image.create({
        data: {
          kind,
          name: imageNameFromFilename(filename),
          publicId: stored.publicId,
          storageKey: stored.storageKey,
          width: stored.width,
          height: stored.height,
          bytes: stored.bytes,
          uploadedById: session.userId,
        },
        select: imageSelect,
      });
      created.push(serializeImage(row));
    } catch (error) {
      // The file is on disk but has no row: remove it so it is not orphaned.
      await deleteStoredImage(stored.storageKey).catch((err) =>
        logger.error({ err }, "failed to remove orphaned library image"),
      );
      throw error;
    }
  }

  await recordAudit({
    action: "image.upload",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    userId: session.userId,
    metadata: { kind, uploaded: created.length, rejected: rejected.length },
  });

  return NextResponse.json(
    { images: created, rejected },
    { status: created.length > 0 ? 201 : 400 },
  );
}
