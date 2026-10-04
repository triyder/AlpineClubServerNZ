import { describe, it, expect } from "vitest";
import {
  IMAGE_NAME_MAX,
  imageNameFromFilename,
  imageRenameSchema,
  isImageKind,
  libraryImageUrl,
  serializeImage,
  toImageRef,
  type ImageRecord,
} from "@/lib/image-library";

describe("imageNameFromFilename", () => {
  it("drops the extension and keeps a readable label", () => {
    expect(imageNameFromFilename("Ruapehu Lodge.jpg")).toBe("Ruapehu Lodge");
    expect(imageNameFromFilename("logo.final.PNG")).toBe("logo.final");
  });

  it("drops any directory part, whichever separator it uses (never a path)", () => {
    expect(imageNameFromFilename("../../etc/passwd.png")).toBe("passwd");
    expect(imageNameFromFilename("C:\\Users\\me\\Pictures\\hut.webp")).toBe("hut");
    expect(imageNameFromFilename("/abs/path/hut.jpeg")).toBe("hut");
  });

  it("collapses whitespace and trims", () => {
    expect(imageNameFromFilename("  big   hut  .jpg")).toBe("big hut");
  });

  it("falls back to a placeholder when nothing is left", () => {
    expect(imageNameFromFilename("")).toBe("Untitled");
    expect(imageNameFromFilename(".png")).toBe("Untitled");
    expect(imageNameFromFilename("   .jpg")).toBe("Untitled");
  });

  it("bounds the length", () => {
    const name = imageNameFromFilename(`${"x".repeat(500)}.jpg`);
    expect(name).toHaveLength(IMAGE_NAME_MAX);
  });
});

describe("imageRenameSchema", () => {
  it("trims and accepts a normal name", () => {
    const parsed = imageRenameSchema.safeParse({ name: "  Hut  " });
    expect(parsed.success && parsed.data.name).toBe("Hut");
  });

  it("rejects blank, over-long, and any other key (the type cannot be changed)", () => {
    expect(imageRenameSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(imageRenameSchema.safeParse({ name: "x".repeat(IMAGE_NAME_MAX + 1) }).success).toBe(false);
    expect(imageRenameSchema.safeParse({ name: "a", kind: "LOGO" }).success).toBe(false);
    expect(imageRenameSchema.safeParse({}).success).toBe(false);
  });
});

describe("isImageKind", () => {
  it("accepts exactly IMAGE and LOGO", () => {
    expect(isImageKind("IMAGE")).toBe(true);
    expect(isImageKind("LOGO")).toBe(true);
    for (const bad of ["image", "logo", "", "ICON", null, undefined, 1]) {
      expect(isImageKind(bad)).toBe(false);
    }
  });
});

describe("urls and references", () => {
  it("builds the public capability URL from the public id, never the row id", () => {
    expect(libraryImageUrl("abc123")).toBe("/api/images/library/abc123.webp");
  });

  it("toImageRef maps a row, and null/undefined to null", () => {
    expect(toImageRef({ id: "i1", name: "Hut", publicId: "pub" })).toEqual({
      id: "i1",
      name: "Hut",
      url: "/api/images/library/pub.webp",
    });
    expect(toImageRef(null)).toBeNull();
    expect(toImageRef(undefined)).toBeNull();
  });
});

describe("serializeImage", () => {
  const at = new Date("2026-03-01T10:00:00.000Z");
  const row = (over: Partial<ImageRecord> = {}): ImageRecord => ({
    id: "i1",
    kind: "LOGO",
    name: "Logo",
    publicId: "pub",
    width: 100,
    height: 50,
    bytes: 1234,
    createdAt: at,
    lodgesUsingAsImage: [],
    lodgesUsingAsLogo: [],
    ...over,
  });

  it("serialises the fields and the public URL, and never exposes the storage key", () => {
    const out = serializeImage(row());
    expect(out).toEqual({
      id: "i1",
      kind: "LOGO",
      name: "Logo",
      url: "/api/images/library/pub.webp",
      width: 100,
      height: 50,
      bytes: 1234,
      createdAt: "2026-03-01T10:00:00.000Z",
      usedBy: [],
    });
    expect(out).not.toHaveProperty("storageKey");
    expect(out).not.toHaveProperty("publicId");
  });

  it("lists each using lodge once, alphabetically, across image and logo use", () => {
    const out = serializeImage(
      row({
        lodgesUsingAsImage: [{ name: "Zeta Lodge" }, { name: "Alpha Lodge" }],
        lodgesUsingAsLogo: [{ name: "Alpha Lodge" }, { name: "Mid Lodge" }],
      }),
    );
    expect(out.usedBy).toEqual(["Alpha Lodge", "Mid Lodge", "Zeta Lodge"]);
  });
});
