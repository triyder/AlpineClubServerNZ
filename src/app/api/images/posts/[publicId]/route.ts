import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveStorageKey } from "@/lib/uploads";
import { logger } from "@/lib/logger";

/**
 * GET /api/images/posts/:publicId(.webp) — serve one optimised post image.
 *
 * Deliberately OUTSIDE /api/v1: this is not part of the authenticated client
 * API. A browser `<img src>` cannot send an Authorization header, so these are
 * capability URLs — the 128-bit random `publicId` is unguessable, which is what
 * protects the image, not an access check. A leaked URL exposes that one image
 * and nothing else, and ids are random rather than derived from the post id so
 * holding a feed page never lets anyone enumerate the rest.
 *
 * Files live under UPLOADS_DIR, outside `public/`, because Next only serves
 * assets that existed at build time and the Dockerfile bakes `public/` into the
 * image.
 */

// Reads from disk and the database, so it must never be statically optimised.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId: raw } = await params;

  // The route is linked as `<publicId>.webp` so the URL looks like a file and
  // caches sensibly; the extension is cosmetic and stripped before lookup.
  const publicId = raw?.replace(/\.webp$/i, "") ?? "";

  // Shape-check before touching the database: publicId is always 32 hex chars,
  // so anything else is a probe and does not deserve a query.
  if (!/^[0-9a-f]{32}$/.test(publicId)) {
    return new NextResponse(null, { status: 404 });
  }

  const image = await prisma.postImage.findUnique({
    where: { publicId },
    select: {
      storageKey: true,
      bytes: true,
      // A removed post's images are unlinked immediately, but check the parent
      // anyway: it closes the window between the row being marked and the file
      // actually going, and it means a stub row can never serve content.
      post: { select: { removedAt: true } },
    },
  });

  if (!image || image.post.removedAt) {
    return new NextResponse(null, { status: 404 });
  }

  let body: Buffer;
  try {
    body = await readFile(resolveStorageKey(image.storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Row without a file: the orphan case the cleanup sweep exists to fix.
      // Worth logging — it should not happen, and silence would hide a real
      // storage fault behind an ordinary-looking 404.
      logger.warn({ publicId }, "post image row has no file on disk");
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.byteLength),
      // Content is immutable per id — a post edit never rewrites an existing
      // image, it creates a new row — so a long cache is safe, and a removed
      // post's URL simply starts 404ing. `private` keeps it out of shared
      // caches, since the URL is the only thing protecting the image.
      "Cache-Control": "private, max-age=31536000, immutable",
      // These are member photos reached by an unguessable URL; keep them out of
      // search indexes and stop the URL leaking through a referrer header.
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
