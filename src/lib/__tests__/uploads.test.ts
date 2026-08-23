import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// UPLOADS_DIR is read at call time via env.ts, but set it before importing the
// module under test so nothing captures a stale value at module scope.
const tempRoot = await mkdtemp(path.join(tmpdir(), "acs-uploads-"));
process.env.UPLOADS_DIR = tempRoot;

const {
  assertBatchWithinLimits,
  deleteStoredImage,
  ImageRejectedError,
  MAX_IMAGE_BYTES_TOTAL,
  resolveStorageKey,
  sniffImageType,
  uploadsRoot,
  writeProcessedImage,
} = await import("@/lib/uploads");

/** A real JPEG carrying EXIF, including a GPS tag. */
async function jpegWithGps(width = 40, height = 30): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    // IFD3 is the GPS IFD in libvips' exif model, so this fixture carries the
    // location tags a phone photo would — the thing the pipeline must drop.
    .withExif({
      IFD0: { Copyright: "Alpine Club" },
      IFD3: { GPSLatitudeRef: "S", GPSLongitudeRef: "E" },
    })
    .jpeg()
    .toBuffer();
}

async function pngBuffer(width = 20, height = 20): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
}

describe("uploads — magic-byte validation", () => {
  it("identifies genuine JPEG, PNG and WebP", async () => {
    expect(sniffImageType(await jpegWithGps())).toBe("jpeg");
    expect(sniffImageType(await pngBuffer())).toBe("png");
    const webp = await sharp(await pngBuffer()).webp().toBuffer();
    expect(sniffImageType(webp)).toBe("webp");
  });

  it("rejects a non-image whatever it claims to be", () => {
    // The exact shape a malicious upload takes: a script named .jpg. The
    // declared content type is not evidence, so only the bytes are consulted.
    const script = Buffer.from("#!/bin/sh\nrm -rf /\n", "utf8");
    expect(sniffImageType(script)).toBeNull();
  });

  it("rejects a truncated header rather than reading past the end", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it("refuses to process a file that is not an image", async () => {
    await expect(
      writeProcessedImage(Buffer.from("not an image at all", "utf8")),
    ).rejects.toBeInstanceOf(ImageRejectedError);
  });
});

describe("uploads — processing pipeline", () => {
  it("converts to WebP and stores under a year/month shard", async () => {
    const stored = await writeProcessedImage(
      await jpegWithGps(),
      new Date(Date.UTC(2026, 7, 22)),
    );

    expect(stored.storageKey).toMatch(/^posts\/2026\/08\/[0-9a-f]{32}\.webp$/);
    // 128 bits of randomness, independent of any row id.
    expect(stored.publicId).toMatch(/^[0-9a-f]{32}$/);

    const written = await readFile(resolveStorageKey(stored.storageKey));
    expect(sniffImageType(written)).toBe("webp");
    expect(stored.bytes).toBe(written.byteLength);
  });

  it("strips EXIF, so GPS coordinates never reach other clubs", async () => {
    const source = await jpegWithGps();
    // Guard the fixture itself: if sharp stopped embedding EXIF this test
    // would pass vacuously and stop protecting anything.
    expect((await sharp(source).metadata()).exif).toBeDefined();

    const stored = await writeProcessedImage(source);
    const output = await readFile(resolveStorageKey(stored.storageKey));
    const meta = await sharp(output).metadata();

    expect(meta.exif).toBeUndefined();
  });

  it("resizes down to the bounding box but never enlarges", async () => {
    const big = await writeProcessedImage(await jpegWithGps(4000, 3000));
    expect(big.width).toBeLessThanOrEqual(1920);
    expect(big.height).toBeLessThanOrEqual(1080);
    // Aspect ratio preserved: 4000x3000 is 4:3, so the height binds first.
    expect(big.height).toBe(1080);

    const small = await writeProcessedImage(await jpegWithGps(40, 30));
    expect(small.width).toBe(40);
    expect(small.height).toBe(30);
  });
});

describe("uploads — batch limits", () => {
  it("accepts a batch within both limits", () => {
    expect(() => assertBatchWithinLimits([1000, 2000, 3000, 4000])).not.toThrow();
  });

  it("rejects more than four images", () => {
    expect(() => assertBatchWithinLimits([1, 1, 1, 1, 1])).toThrow(
      /at most 4 images/,
    );
  });

  it("rejects on the COMBINED size, not per file", () => {
    // Four files each comfortably under the total, but not together. This is
    // the case a per-file cap would wave through and Caddy would then reject
    // at the edge with an unexplainable 413.
    const each = Math.ceil(MAX_IMAGE_BYTES_TOTAL / 3);
    expect(() => assertBatchWithinLimits([each, each, each, each])).toThrow(
      /combined limit/,
    );
  });

  it("accepts an empty batch — a post need not carry images", () => {
    expect(() => assertBatchWithinLimits([])).not.toThrow();
  });
});

describe("uploads — path safety", () => {
  it("resolves a normal key inside the root", () => {
    const resolved = resolveStorageKey("posts/2026/08/abc.webp");
    expect(resolved.startsWith(uploadsRoot())).toBe(true);
  });

  it("refuses keys that climb out of the uploads root", () => {
    for (const key of [
      "../escape.webp",
      "posts/../../escape.webp",
      "posts/2026/../../../etc/passwd",
    ]) {
      expect(() => resolveStorageKey(key)).toThrow(ImageRejectedError);
    }
  });

  it("refuses an absolute path", () => {
    expect(() => resolveStorageKey(path.resolve("/etc/passwd"))).toThrow(
      ImageRejectedError,
    );
  });

  it("refuses the root itself", () => {
    expect(() => resolveStorageKey("")).toThrow(ImageRejectedError);
  });
});

describe("uploads — deletion", () => {
  it("removes a stored file and reports it", async () => {
    const stored = await writeProcessedImage(await pngBuffer());
    expect(await deleteStoredImage(stored.storageKey)).toBe(true);
  });

  it("treats a missing file as a no-op, not an error", async () => {
    // Cleanup runs after crashes and partial writes, so an already-gone file
    // must not block the tidy-up that situation calls for.
    expect(await deleteStoredImage("posts/2026/08/never-existed.webp")).toBe(
      false,
    );
  });

  it("returns false rather than throwing for an unresolvable key", async () => {
    expect(await deleteStoredImage("../../outside.webp")).toBe(false);
  });

  it("does not delete anything outside the root", async () => {
    const outside = path.join(tempRoot, "..", "acs-bystander.txt");
    await mkdir(path.dirname(outside), { recursive: true });
    await writeFile(outside, "untouched");

    await deleteStoredImage("../acs-bystander.txt");

    expect(await readFile(outside, "utf8")).toBe("untouched");
    await rm(outside, { force: true });
  });
});

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});
