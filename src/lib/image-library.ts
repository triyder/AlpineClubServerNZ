import { z } from "zod";
import type { Prisma } from "@prisma/client";

/**
 * Helpers for the image library (`/admin/image-manager`): pictures an
 * administrator uploads once and then attaches to a lodge as its picture or its
 * logo. No `server-only` here — the picker components import the types.
 */

export type ImageKindValue = "IMAGE" | "LOGO";

export const IMAGE_KINDS: readonly ImageKindValue[] = ["IMAGE", "LOGO"];

export function isImageKind(value: unknown): value is ImageKindValue {
  return value === "IMAGE" || value === "LOGO";
}

/** Public, unguessable URL for one stored picture (see api/images/library). */
export function libraryImageUrl(publicId: string): string {
  return `/api/images/library/${publicId}.webp`;
}

/** What the lodge screens need to show a chosen picture. */
export interface LodgeImageRef {
  id: string;
  name: string;
  url: string;
}

export const imageRefSelect = {
  id: true,
  name: true,
  publicId: true,
} satisfies Prisma.ImageSelect;

export function toImageRef(
  image: { id: string; name: string; publicId: string } | null | undefined,
): LodgeImageRef | null {
  return image
    ? { id: image.id, name: image.name, url: libraryImageUrl(image.publicId) }
    : null;
}

export const imageSelect = {
  id: true,
  kind: true,
  name: true,
  publicId: true,
  width: true,
  height: true,
  bytes: true,
  createdAt: true,
  lodgesUsingAsImage: { select: { name: true }, orderBy: { name: "asc" } },
  lodgesUsingAsLogo: { select: { name: true }, orderBy: { name: "asc" } },
} satisfies Prisma.ImageSelect;

export type ImageRecord = Prisma.ImageGetPayload<{ select: typeof imageSelect }>;

export interface SerializedImage {
  id: string;
  kind: ImageKindValue;
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
  /** Names of the lodges using this picture (as image or logo). */
  usedBy: string[];
}

export function serializeImage(image: ImageRecord): SerializedImage {
  const usedBy = [
    ...new Set([
      ...image.lodgesUsingAsImage.map((l) => l.name),
      ...image.lodgesUsingAsLogo.map((l) => l.name),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  return {
    id: image.id,
    kind: image.kind,
    name: image.name,
    url: libraryImageUrl(image.publicId),
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    createdAt: image.createdAt.toISOString(),
    usedBy,
  };
}

export const IMAGE_NAME_MAX = 200;

/**
 * A display name from an uploaded file name: directory parts and the extension
 * dropped, whitespace collapsed, bounded. The file name is caller-supplied text
 * that ends up on a page, so it is only ever kept as a label and never used as
 * a path.
 */
export function imageNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const cleaned = withoutExtension.replace(/\s+/g, " ").trim();
  return (cleaned || "Untitled").slice(0, IMAGE_NAME_MAX);
}

export const imageRenameSchema = z
  .object({ name: z.string().trim().min(1).max(IMAGE_NAME_MAX) })
  .strict();
