import "server-only";
import { prisma } from "@/lib/db";

export type LodgePictureLabel = "lodge image" | "lodge logo" | "picture";

/**
 * The one message for a chosen picture that is not there, whether the check
 * below found it missing or the write itself did (the picture was deleted in
 * the moment between the two: Prisma P2025 on the `connect`).
 */
export function missingPictureMessage(label: LodgePictureLabel): string {
  return `The chosen ${label} no longer exists. Choose another.`;
}

/**
 * Which picture a failed `connect` must have been about, for the message above:
 * known when only one was chosen, otherwise just "picture".
 */
export function chosenPictureLabel(input: {
  imageId?: string | null;
  logoId?: string | null;
}): LodgePictureLabel | null {
  const image = Boolean(input.imageId);
  const logo = Boolean(input.logoId);
  if (image && logo) return "picture";
  if (image) return "lodge image";
  if (logo) return "lodge logo";
  return null;
}

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
  const wanted: Array<{ id: string; kind: "IMAGE" | "LOGO"; label: LodgePictureLabel }> = [];
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
    if (!kind) return missingPictureMessage(w.label);
    if (kind !== w.kind) {
      return w.kind === "IMAGE"
        ? "A logo cannot be used as the lodge image. Choose a lodge image."
        : "A lodge image cannot be used as the logo. Choose a logo.";
    }
  }
  return null;
}
