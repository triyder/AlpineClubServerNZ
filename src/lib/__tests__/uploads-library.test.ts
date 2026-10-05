import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// UPLOADS_DIR is read at call time, but set it before importing the module so
// nothing captures a stale value.
const tempRoot = await mkdtemp(path.join(tmpdir(), "acs-library-"));
process.env.UPLOADS_DIR = tempRoot;

const {
  assertBatchWithinLimits,
  ImageRejectedError,
  LIBRARY_IMAGE_PROFILE,
  LIBRARY_LOGO_PROFILE,
  POST_IMAGE_PROFILE,
  resolveStorageKey,
  writeProcessedImage,
} = await import("@/lib/uploads");
const { LIBRARY_MAX_FILES } = await import("@/lib/image-library");

// sharp memory-maps files it reads, which on Windows keeps them locked and makes
// the temp-folder cleanup below fail with EBUSY. Turning its cache off releases
// them; the cleanup is best-effort either way, since a leftover temp folder is
// not a test failure.
sharp.cache(false);

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

/** A PNG with a half-transparent background, like a typical logo. */
async function transparentPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 30, b: 30, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
}

async function opaqueJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 90, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

describe("image profiles", () => {
  it("keeps posts at their original folder and size (the default is unchanged)", () => {
    expect(POST_IMAGE_PROFILE).toEqual({ folder: "posts", maxWidth: 1920, maxHeight: 1080 });
  });

  it("stores a library image under library/ at the post size", () => {
    expect(LIBRARY_IMAGE_PROFILE).toEqual({ folder: "library", maxWidth: 1920, maxHeight: 1080 });
  });

  it("stores a logo under library/ no larger than 600 by 600", () => {
    expect(LIBRARY_LOGO_PROFILE).toEqual({ folder: "library", maxWidth: 600, maxHeight: 600 });
  });
});

describe("writeProcessedImage with a library profile", () => {
  const now = new Date("2026-10-04T00:00:00.000Z");

  it("puts the file under library/<year>/<month>/ and nowhere else", async () => {
    const stored = await writeProcessedImage(await opaqueJpeg(40, 30), now, LIBRARY_IMAGE_PROFILE);
    expect(stored.storageKey).toMatch(/^library\/2026\/10\/[0-9a-f]{32}\.webp$/);
    // Resolves inside the uploads root (the traversal guard accepts it).
    expect(resolveStorageKey(stored.storageKey).startsWith(path.resolve(tempRoot))).toBe(true);
  });

  it("still defaults to posts/ when no profile is given", async () => {
    const stored = await writeProcessedImage(await opaqueJpeg(40, 30), now);
    expect(stored.storageKey).toMatch(/^posts\/2026\/10\//);
  });

  it("shrinks a large logo to fit 600 by 600, keeping its proportions", async () => {
    const stored = await writeProcessedImage(await transparentPng(2000, 1000), now, LIBRARY_LOGO_PROFILE);
    expect(stored.width).toBe(600);
    expect(stored.height).toBe(300);
  });

  it("shrinks a large lodge image to fit 1920 by 1080", async () => {
    const stored = await writeProcessedImage(await opaqueJpeg(4000, 3000), now, LIBRARY_IMAGE_PROFILE);
    expect(stored.width).toBeLessThanOrEqual(1920);
    expect(stored.height).toBeLessThanOrEqual(1080);
  });

  it("never enlarges a small picture", async () => {
    const stored = await writeProcessedImage(await transparentPng(50, 40), now, LIBRARY_LOGO_PROFILE);
    expect(stored).toMatchObject({ width: 50, height: 40 });
  });

  it("keeps a logo's transparency through the WebP re-encode", async () => {
    const stored = await writeProcessedImage(await transparentPng(80, 80), now, LIBRARY_LOGO_PROFILE);
    const meta = await sharp(resolveStorageKey(stored.storageKey)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
  });

  it("still refuses a file that is not an image", async () => {
    await expect(
      writeProcessedImage(Buffer.from("<?php echo 1; ?>"), now, LIBRARY_LOGO_PROFILE),
    ).rejects.toBeInstanceOf(ImageRejectedError);
  });
});

describe("assertBatchWithinLimits with a custom count", () => {
  it("defaults to the post limit and wording", () => {
    expect(() => assertBatchWithinLimits([1, 1, 1, 1, 1])).toThrow(/A post may carry at most 4/);
  });

  it("applies a caller's count and subject", () => {
    expect(() =>
      assertBatchWithinLimits(Array(LIBRARY_MAX_FILES).fill(1), LIBRARY_MAX_FILES, "One upload"),
    ).not.toThrow();
    expect(() =>
      assertBatchWithinLimits(Array(LIBRARY_MAX_FILES + 1).fill(1), LIBRARY_MAX_FILES, "One upload"),
    ).toThrow(/One upload may carry at most 10/);
  });

  it("still enforces the combined byte budget", () => {
    expect(() =>
      assertBatchWithinLimits([5 * 1024 * 1024, 5 * 1024 * 1024], 10, "One upload"),
    ).toThrow(/combined limit/);
  });
});
