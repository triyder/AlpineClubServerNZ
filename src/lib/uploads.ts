import "server-only";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { uploadsDir } from "@/lib/env";

/**
 * Storage and optimisation for post images.
 *
 * Every uploaded file is decoded, resized, re-encoded as WebP and written to
 * local disk; the original is never persisted. Callers hand us bytes and get
 * back the row data for a `PostImage`.
 */

/**
 * Caddy caps the whole request body at 10MB (Caddyfile:27) and that cap stays,
 * so the image budget is sized to fit underneath it with room for multipart
 * boundaries and the text fields.
 *
 * Note this is a COMBINED budget, not per-file: a post may carry four images or
 * one, but their total must fit. Clients must show a running total, because a
 * body that exceeds the Caddy limit is rejected at the edge as a bare 413 with
 * no JSON body for them to explain.
 */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES_TOTAL = 9 * 1024 * 1024;

/** Longest edge of the stored derivative. */
export const MAX_WIDTH = 1920;
export const MAX_HEIGHT = 1080;
export const WEBP_QUALITY = 80;

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
function buildStorageKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  // Random rather than derived from the post id: the two are independent, so
  // learning one never reveals the other.
  const name = randomBytes(16).toString("hex");
  return path.posix.join("posts", String(year), month, `${name}.webp`);
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
        width: MAX_WIDTH,
        height: MAX_HEIGHT,
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

  const storageKey = buildStorageKey(now);
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
export function assertBatchWithinLimits(sizes: number[]): void {
  if (sizes.length > MAX_IMAGES) {
    throw new ImageRejectedError(
      `A post may carry at most ${MAX_IMAGES} images (received ${sizes.length})`,
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
