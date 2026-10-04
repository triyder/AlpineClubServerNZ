import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveStorageKey } from "@/lib/uploads";
import { logger } from "@/lib/logger";

/**
 * GET /api/images/library/:publicId(.webp) — serve one stored library picture.
 *
 * Outside /api/v1 for the same reason as the post images: a browser `<img>`
 * cannot send an Authorization header, so these are capability URLs. The 128-bit
 * random `publicId` is what protects a picture, and a leaked URL exposes that one
 * picture and nothing else.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId: raw } = await params;
  const publicId = raw?.replace(/\.webp$/i, "") ?? "";

  // Shape-check before touching the database: anything but 32 hex characters is
  // a probe and does not deserve a query.
  if (!/^[0-9a-f]{32}$/.test(publicId)) {
    return new NextResponse(null, { status: 404 });
  }

  const image = await prisma.image.findUnique({
    where: { publicId },
    select: { storageKey: true },
  });
  if (!image) return new NextResponse(null, { status: 404 });

  let body: Buffer;
  try {
    body = await readFile(resolveStorageKey(image.storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn({ publicId }, "library image row has no file on disk");
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.byteLength),
      // Content is immutable per id: a rename changes the label, never the bytes,
      // and a deleted picture's URL simply starts 404ing.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
