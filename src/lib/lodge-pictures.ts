import "server-only";
import { prisma } from "@/lib/db";

/**
 * Check a lodge's chosen picture and logo against the image library.
 *
 * The schema only bounds the shape of an id; this is what makes a lodge unable
 * to point at a picture that does not exist, or to be given a logo as its
 * picture (or the reverse) — the picker never offers either, so reaching here
 * with one means a hand-built request.
 *
 * Returns an error message for the administrator, or `null` when fine. A `null`
 * or omitted id is always fine: it clears or leaves the field.
 */
export async function validateLodgePictures(input: {
  imageId?: string | null;
  logoId?: string | null;
}): Promise<string | null> {
  const wanted: Array<{ id: string; kind: "IMAGE" | "LOGO"; label: string }> = [];
  if (input.imageId) wanted.push({ id: input.imageId, kind: "IMAGE", label: "lodge image" });
  if (input.logoId) wanted.push({ id: input.logoId, kind: "LOGO", label: "lodge logo" });
  if (wanted.length === 0) return null;

  const found = await prisma.image.findMany({
    where: { id: { in: wanted.map((w) => w.id) } },
    select: { id: true, kind: true },
  });
  const kinds = new Map(found.map((row) => [row.id, row.kind]));

  for (const w of wanted) {
    const kind = kinds.get(w.id);
    if (!kind) return `The chosen ${w.label} no longer exists. Choose another.`;
    if (kind !== w.kind) {
      return w.kind === "IMAGE"
        ? "A logo cannot be used as the lodge image. Choose a lodge image."
        : "A lodge image cannot be used as the logo. Choose a logo.";
    }
  }
  return null;
}
