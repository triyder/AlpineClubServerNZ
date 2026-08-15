import { z } from "zod";
import type { OtherLodge, Prisma } from "@prisma/client";

/**
 * Helpers for the central "Other lodges" registry (Admin -> Lodges). Replicates
 * the AlpineClubBookingsNZ registry, plus the distribution marker and source-
 * club provenance that make this the shared, distributable source of truth.
 */

export const otherLodgeSelect = {
  id: true,
  name: true,
  location: true,
  bookingOfficerName: true,
  bookingOfficerEmail: true,
  bookingOfficerPhone: true,
  bedCapacity: true,
  distribute: true,
  sourceClubId: true,
  sourceClub: { select: { id: true, name: true, code: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OtherLodgeSelect;

export type OtherLodgeRecord = Prisma.OtherLodgeGetPayload<{
  select: typeof otherLodgeSelect;
}>;

export interface SerializedOtherLodge {
  id: string;
  name: string;
  location: string | null;
  bookingOfficerName: string | null;
  bookingOfficerEmail: string | null;
  bookingOfficerPhone: string | null;
  bedCapacity: number | null;
  distribute: boolean;
  sourceClub: { id: string; name: string; code: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeOtherLodge(
  lodge: OtherLodgeRecord,
): SerializedOtherLodge {
  return {
    id: lodge.id,
    name: lodge.name,
    location: lodge.location,
    bookingOfficerName: lodge.bookingOfficerName,
    bookingOfficerEmail: lodge.bookingOfficerEmail,
    bookingOfficerPhone: lodge.bookingOfficerPhone,
    bedCapacity: lodge.bedCapacity,
    distribute: lodge.distribute,
    sourceClub: lodge.sourceClub
      ? {
          id: lodge.sourceClub.id,
          name: lodge.sourceClub.name,
          code: lodge.sourceClub.code,
        }
      : null,
    createdAt: lodge.createdAt.toISOString(),
    updatedAt: lodge.updatedAt.toISOString(),
  };
}

// Alphabetical, name-first; tie-break on id for deterministic ordering.
export function otherLodgeOrderBy() {
  return [
    { name: "asc" },
    { id: "asc" },
  ] satisfies Prisma.OtherLodgeOrderByWithRelationInput[];
}

// Trim to a stored value, folding blank/whitespace-only input to null so an
// "empty" optional field never persists as "".
export function normalizeOtherLodgeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// An optional email that treats blank input as "not set": the admin form sends
// "" for a cleared field, and "" is not a valid email — fold it to null before
// the format check so clearing the field is not a validation error.
const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(320).email().nullable().optional(),
);

export const otherLodgeCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    location: z.string().trim().max(300).nullable().optional(),
    bookingOfficerName: z.string().trim().max(200).nullable().optional(),
    bookingOfficerEmail: optionalEmail,
    bookingOfficerPhone: z.string().trim().max(50).nullable().optional(),
    // Informational bed count; non-negative, capped well above any real lodge.
    bedCapacity: z.number().int().min(0).max(100000).nullable().optional(),
    distribute: z.boolean().optional(),
  })
  .strict();
export type OtherLodgeCreateInput = z.infer<typeof otherLodgeCreateSchema>;

export const otherLodgeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    location: z.string().trim().max(300).nullable().optional(),
    bookingOfficerName: z.string().trim().max(200).nullable().optional(),
    bookingOfficerEmail: optionalEmail,
    bookingOfficerPhone: z.string().trim().max(50).nullable().optional(),
    bedCapacity: z.number().int().min(0).max(100000).nullable().optional(),
    distribute: z.boolean().optional(),
  })
  .strict();
export type OtherLodgeUpdateInput = z.infer<typeof otherLodgeUpdateSchema>;
