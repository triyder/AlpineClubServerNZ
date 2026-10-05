import "server-only";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { uploadsDir } from "@/lib/env";
import { MAX_IMAGE_BYTES_TOTAL } from "@/lib/image-library";

/**
 * Storage and optimisation for every image this server keeps: post images and
 * the image library's lodge pictures and logos.
 *
 * Every uploaded file is decoded, resized, re-encoded as WebP and written to
 * local disk; the original is never persisted. Callers hand us bytes and get
 * back the row data for a `PostImage` or an `Image`.
 */

/**
 * Most images one post may carry. The COMBINED byte budget they share
 * (`MAX_IMAGE_BYTES_TOTAL`) is defined in `image-library.ts`, beside the library
 * batch limit, because the browser mirrors both; the Caddy body cap it sits
 * under is explained there. A post may carry four images or one, but their
 * total must fit, so clients show a running total.
 */
export const MAX_IMAGES = 4;

/** Longest edge of the stored derivative. */
export const MAX_WIDTH = 1920;
export const MAX_HEIGHT = 1080;
export const WEBP_QUALITY = 80;

/**
 * Where a processed image is stored and how large it may be. The storage
 * folder is a closed set of server-defined names, never caller input, so a
 * profile cannot be used to place a file anywhere else under the uploads root.
 */
export interface ImageProfile {
  folder: "posts" | "library";
  maxWidth: number;
  maxHeight: number;
}

export const POST_IMAGE_PROFILE: ImageProfile = {
  folder: "posts",
  maxWidth: MAX_WIDTH,
  maxHeight: MAX_HEIGHT,
};

/** Image library: a lodge picture, stored at the same size as a post image. */
export const LIBRARY_IMAGE_PROFILE: ImageProfile = {
  folder: "library",
  maxWidth: MAX_WIDTH,
  maxHeight: MAX_HEIGHT,
};

/** Image library: a logo, stored small. WebP keeps its transparency. */
export const LIBRARY_LOGO_PROFILE: ImageProfile = {
  folder: "library",
  maxWidth: 600,
  maxHeight: 600,
};

/**
 * Ceiling on decoded pixels. A small file can decode to an enormous bitmap, so
 * the byte budget above is no protection on its own — this is what stops a
 * decompression bomb exhausting the container's memory.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

export interface StoredImage {
  storageKey: string;
  publicId: string;
  width: number;
  height: number;
  bytes: number;
}

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

/** Absolute uploads root, resolved once per call. */
export function uploadsRoot(): string {
  return path.resolve(uploadsDir());
}

/**
 * Resolve a stored key against the uploads root, refusing anything that escapes
 * it.
 *
 * Keys are server-generated today, so this is defence in depth rather than a
 * live hole — but it is the single choke point every read and unlink passes
 * through, so if a key ever does become caller-influenced the guarantee already
 * holds. `path.resolve` collapses `..` before the check, so the comparison is
 * on the real target rather than the literal string.
 */
export function resolveStorageKey(key: string): string {
  const root = uploadsRoot();
  const target = path.resolve(root, key);
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ImageRejectedError("Refusing to resolve a path outside uploads");
  }
  return target;
}

/**
 * Magic-byte sniff. The declared Content-Type on a multipart part is attacker
 * controlled and proves nothing, so the leading bytes are the only evidence
 * worth acting on.
 */
export function sniffImageType(
  buf: Buffer,
): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // RIFF....WEBP — the four size bytes between the two markers are skipped.
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** Sharded by year/month so no single directory grows without bound. */
function buildStorageKey(now: Date, folder: ImageProfile["folder"]): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  // Random rather than derived from the post id: the two are independent, so
  // learning one never reveals the other.
  const name = randomBytes(16).toString("hex");
  return path.posix.join(folder, String(year), month, `${name}.webp`);
}

/**
 * Validate, optimise and store one image.
 *
 * Throws `ImageRejectedError` for anything that is not a real JPEG/PNG/WebP or
 * that sharp cannot decode within the pixel ceiling.
 */
export async function writeProcessedImage(
  input: Buffer,
  now: Date = new Date(),
  profile: ImageProfile = POST_IMAGE_PROFILE,
): Promise<StoredImage> {
  if (sniffImageType(input) === null) {
    throw new ImageRejectedError("File is not a JPEG, PNG or WebP image");
  }

  let output: Buffer;
  let info: OutputInfo;
  try {
    const result = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    })
      .rotate() // honour the EXIF orientation flag before that metadata is dropped
      .resize({
        width: profile.maxWidth,
        height: profile.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      // No .withMetadata(): sharp drops EXIF by default, which is what strips
      // the GPS coordinates embedded in members' phone photos. Adding it back
      // would quietly publish where every picture was taken.
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    output = result.data;
    info = result.info;
  } catch (err) {
    throw new ImageRejectedError(
      `Image could not be processed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
  }

  const storageKey = buildStorageKey(now, profile.folder);
  const absolute = resolveStorageKey(storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, output);

  return {
    storageKey,
    // 128 bits of randomness, independent of the row id, so holding one feed
    // page never lets anyone enumerate images of posts they were not sent.
    publicId: randomBytes(16).toString("hex"),
    width: info.width,
    height: info.height,
    bytes: output.byteLength,
  };
}

/**
 * Delete a stored derivative.
 *
 * A missing file is a no-op, not an error: cleanup runs after crashes and
 * partial writes, and refusing to proceed because a file is already gone would
 * block the very tidy-up that situation calls for. Returns whether a file was
 * actually removed.
 */
export async function deleteStoredImage(key: string): Promise<boolean> {
  let absolute: string;
  try {
    absolute = resolveStorageKey(key);
  } catch {
    // An unresolvable key cannot name a file we wrote, so there is nothing to
    // delete and nothing to report.
    return false;
  }

  try {
    await unlink(absolute);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Validate the combined size and count of a batch before any of it is decoded.
 * Checked first so an oversized request is refused cheaply.
 */
export function assertBatchWithinLimits(
  sizes: number[],
  maxCount: number = MAX_IMAGES,
  subject: string = "A post",
): void {
  if (sizes.length > maxCount) {
    throw new ImageRejectedError(
      `${subject} may carry at most ${maxCount} images (received ${sizes.length})`,
    );
  }
  const total = sizes.reduce((sum, n) => sum + n, 0);
  if (total > MAX_IMAGE_BYTES_TOTAL) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    throw new ImageRejectedError(
      `Images total ${mb(total)}MB; the combined limit is ${mb(MAX_IMAGE_BYTES_TOTAL)}MB`,
    );
  }
}
