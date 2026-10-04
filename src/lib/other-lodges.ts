import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  imageRefSelect,
  toImageRef,
  type LodgeImageRef,
} from "@/lib/image-library";

/**
 * Helpers for the central "Other lodges" registry (Admin -> Lodges). Replicates
 * the AlpineClubBookingsNZ registry, plus source-club provenance, which make
 * this the shared source of truth. Every entry is distributed to every club.
 */

/**
 * The lodge detail columns added in API version 1.1. Kept in ONE list so the
 * select, the serialisers, the validation schemas and the writers cannot drift
 * apart — adding a column here is what makes every one of them carry it.
 */
export const LODGE_BOOLEAN_FIELDS = [
  "requiresLodgeCustodian",
  "freeWifi",
  "quietRoom",
  "dryingRoom",
  "sharedKitchen",
  "wheelchairAccessible",
  "breakfastIncluded",
  "lunchIncluded",
  "dinnerIncluded",
] as const;
export const LODGE_TEXT_FIELDS = [
  "siteUrl",
  "bookingPath",
  "cancellationPeriod",
] as const;
export const LODGE_DATE_FIELDS = [
  "winterSeasonStart",
  "summerSeasonStart",
] as const;

const LODGE_DETAIL_SELECT = {
  siteUrl: true,
  bookingPath: true,
  requiresLodgeCustodian: true,
  freeWifi: true,
  quietRoom: true,
  dryingRoom: true,
  sharedKitchen: true,
  wheelchairAccessible: true,
  breakfastIncluded: true,
  lunchIncluded: true,
  dinnerIncluded: true,
  cancellationPeriod: true,
  winterSeasonStart: true,
  summerSeasonStart: true,
} as const;

export const otherLodgeSelect = {
  id: true,
  name: true,
  location: true,
  bookingOfficerName: true,
  bookingOfficerEmail: true,
  bookingOfficerPhone: true,
  bedCapacity: true,
  ...LODGE_DETAIL_SELECT,
  amenities: {
    select: { name: true, description: true },
    orderBy: { name: "asc" },
  },
  image: { select: imageRefSelect },
  logo: { select: imageRefSelect },
  sourceClubId: true,
  sourceClub: { select: { id: true, name: true, code: true } },
  lastUpdatedByClubId: true,
  lastUpdatedByClub: { select: { id: true, name: true, code: true } },
  lastUploadedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OtherLodgeSelect;

export type OtherLodgeRecord = Prisma.OtherLodgeGetPayload<{
  select: typeof otherLodgeSelect;
}>;

export interface LodgeAmenity {
  name: string;
  description: string | null;
}

/** The detail fields as they leave the server, to admins and to clubs alike. */
export interface SerializedLodgeDetail {
  siteUrl: string | null;
  bookingPath: string | null;
  requiresLodgeCustodian: boolean;
  freeWifi: boolean;
  quietRoom: boolean;
  dryingRoom: boolean;
  sharedKitchen: boolean;
  wheelchairAccessible: boolean;
  breakfastIncluded: boolean;
  lunchIncluded: boolean;
  dinnerIncluded: boolean;
  cancellationPeriod: string | null;
  /** Calendar date `YYYY-MM-DD`, or null. */
  winterSeasonStart: string | null;
  summerSeasonStart: string | null;
  amenities: LodgeAmenity[];
}

/** `YYYY-MM-DD` for a DATE column (read back as UTC midnight), or null. */
export function formatLodgeDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * `YYYY-MM-DD` to the UTC-midnight Date a DATE column stores. UTC on purpose:
 * a local-midnight Date would shift the calendar day by the server's offset.
 */
export function parseLodgeDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function serializeLodgeDetail(lodge: OtherLodgeRecord): SerializedLodgeDetail {
  return {
    siteUrl: lodge.siteUrl,
    bookingPath: lodge.bookingPath,
    requiresLodgeCustodian: lodge.requiresLodgeCustodian,
    freeWifi: lodge.freeWifi,
    quietRoom: lodge.quietRoom,
    dryingRoom: lodge.dryingRoom,
    sharedKitchen: lodge.sharedKitchen,
    wheelchairAccessible: lodge.wheelchairAccessible,
    breakfastIncluded: lodge.breakfastIncluded,
    lunchIncluded: lodge.lunchIncluded,
    dinnerIncluded: lodge.dinnerIncluded,
    cancellationPeriod: lodge.cancellationPeriod,
    winterSeasonStart: formatLodgeDate(lodge.winterSeasonStart),
    summerSeasonStart: formatLodgeDate(lodge.summerSeasonStart),
    amenities: lodge.amenities.map((a) => ({
      name: a.name,
      description: a.description,
    })),
  };
}

export interface SerializedOtherLodge extends SerializedLodgeDetail {
  id: string;
  /** The picture and logo chosen from the image library, if any. */
  image: LodgeImageRef | null;
  logo: LodgeImageRef | null;
  name: string;
  location: string | null;
  bookingOfficerName: string | null;
  bookingOfficerEmail: string | null;
  bookingOfficerPhone: string | null;
  bedCapacity: number | null;
  sourceClub: { id: string; name: string; code: string } | null;
  lastUpdatedByClub: { id: string; name: string; code: string } | null;
  lastUploadedAt: string | null;
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
    ...serializeLodgeDetail(lodge),
    image: toImageRef(lodge.image),
    logo: toImageRef(lodge.logo),
    sourceClub: lodge.sourceClub
      ? {
          id: lodge.sourceClub.id,
          name: lodge.sourceClub.name,
          code: lodge.sourceClub.code,
        }
      : null,
    lastUpdatedByClub: lodge.lastUpdatedByClub
      ? {
          id: lodge.lastUpdatedByClub.id,
          name: lodge.lastUpdatedByClub.name,
          code: lodge.lastUpdatedByClub.code,
        }
      : null,
    lastUploadedAt: lodge.lastUploadedAt
      ? lodge.lastUploadedAt.toISOString()
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

const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

// An optional email that treats blank input as "not set": the admin form sends
// "" for a cleared field, and "" is not a valid email — fold it to null before
// the format check so clearing the field is not a validation error.
const optionalEmail = z.preprocess(
  blankToNull,
  z.string().trim().max(320).email().nullable().optional(),
);

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A real calendar date: `2026-02-30` matches the pattern but is not one. */
function isRealCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

const dateOnlyField = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .refine(isRealCalendarDate, "Not a real calendar date")
    .nullable()
    .optional(),
);

export const AMENITIES_PER_LODGE_MAX = 50;

export const amenityInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.preprocess(
      blankToNull,
      z.string().trim().max(1000).nullable().optional(),
    ),
  })
  .strict();
export type AmenityInput = z.infer<typeof amenityInputSchema>;

/** The whole amenity set for a lodge. Names are unique, ignoring case. */
export const amenitiesInputSchema = z
  .array(amenityInputSchema)
  .max(AMENITIES_PER_LODGE_MAX)
  .refine(
    (list) =>
      new Set(list.map((a) => a.name.toLowerCase())).size === list.length,
    "Amenity names must be unique within a lodge",
  );

/**
 * The detail fields, shared by the admin create/update schemas and the club
 * upload item so all three accept exactly the same values. Every one is
 * optional: omitted means "leave as it is" on an update.
 */
export const lodgeDetailShape = {
  siteUrl: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(500)
      .refine(isHttpUrl, "Site URL must start with http:// or https://")
      .nullable()
      .optional(),
  ),
  bookingPath: z.string().trim().max(300).nullable().optional(),
  requiresLodgeCustodian: z.boolean().optional(),
  freeWifi: z.boolean().optional(),
  quietRoom: z.boolean().optional(),
  dryingRoom: z.boolean().optional(),
  sharedKitchen: z.boolean().optional(),
  wheelchairAccessible: z.boolean().optional(),
  breakfastIncluded: z.boolean().optional(),
  lunchIncluded: z.boolean().optional(),
  dinnerIncluded: z.boolean().optional(),
  cancellationPeriod: z.string().trim().max(200).nullable().optional(),
  winterSeasonStart: dateOnlyField,
  summerSeasonStart: dateOnlyField,
  /** When present, REPLACES the lodge's whole amenity set. */
  amenities: amenitiesInputSchema.optional(),
};

type BooleanFieldKey = (typeof LODGE_BOOLEAN_FIELDS)[number];

type LodgeDetailInput = {
  siteUrl?: string | null;
  bookingPath?: string | null;
  cancellationPeriod?: string | null;
  winterSeasonStart?: string | null;
  summerSeasonStart?: string | null;
} & { [K in BooleanFieldKey]?: boolean };

export type LodgeDetailColumns = {
  siteUrl?: string | null;
  bookingPath?: string | null;
  cancellationPeriod?: string | null;
  winterSeasonStart?: Date | null;
  summerSeasonStart?: Date | null;
} & { [K in BooleanFieldKey]?: boolean };

/**
 * The Prisma column values for whichever detail fields were PROVIDED — a key
 * left out stays out, so a partial update never clears a column it did not
 * mention. Text is trimmed, blank folds to null, dates become UTC-midnight.
 */
export function lodgeDetailColumns(input: LodgeDetailInput): LodgeDetailColumns {
  const data: LodgeDetailColumns = {};
  for (const key of LODGE_TEXT_FIELDS) {
    if (input[key] !== undefined) {
      data[key] = normalizeOtherLodgeText(input[key]);
    }
  }
  for (const key of LODGE_BOOLEAN_FIELDS) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  for (const key of LODGE_DATE_FIELDS) {
    const value = input[key];
    if (value !== undefined) data[key] = value ? parseLodgeDate(value) : null;
  }
  return data;
}

/** True when the provided detail columns would change what is stored. */
export function lodgeDetailDiffers(
  data: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  return Object.keys(data).some((key) => {
    const next = data[key];
    const current = existing[key];
    if (next instanceof Date || current instanceof Date) {
      const a = next instanceof Date ? formatLodgeDate(next) : null;
      const b = current instanceof Date ? formatLodgeDate(current) : null;
      return a !== b;
    }
    return next !== current;
  });
}

type AmenityLike = { name: string; description?: string | null };

/** Normalised, name-keyed form of an amenity list, for comparison. */
function amenityMap(list: ReadonlyArray<AmenityLike>) {
  return new Map(
    list.map(
      (a) => [a.name.trim(), normalizeOtherLodgeText(a.description ?? null)] as const,
    ),
  );
}

/** True when two amenity lists are not the same set of (name, description). */
export function amenitiesDiffer(
  existing: ReadonlyArray<AmenityLike>,
  incoming: ReadonlyArray<AmenityLike>,
): boolean {
  const a = amenityMap(existing);
  const b = amenityMap(incoming);
  if (a.size !== b.size) return true;
  for (const [name, description] of b) {
    if (!a.has(name) || a.get(name) !== description) return true;
  }
  return false;
}

/** The rows to create for a lodge's amenity list (names already unique). */
export function amenityCreateRows(list: ReadonlyArray<AmenityLike>) {
  return list.map((a) => ({
    name: a.name.trim(),
    description: normalizeOtherLodgeText(a.description ?? null),
  }));
}

/**
 * The lodge's picture and logo, chosen from the image library. ADMIN schemas
 * only: a club's upload cannot set them, so this is deliberately not part of
 * `lodgeDetailShape`. Existence and type are checked against the library by
 * `validateLodgePictures`; this only bounds the shape.
 */
const lodgePictureShape = {
  imageId: z.string().trim().min(1).max(64).nullable().optional(),
  logoId: z.string().trim().min(1).max(64).nullable().optional(),
};

export const otherLodgeCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    location: z.string().trim().max(300).nullable().optional(),
    bookingOfficerName: z.string().trim().max(200).nullable().optional(),
    bookingOfficerEmail: optionalEmail,
    bookingOfficerPhone: z.string().trim().max(50).nullable().optional(),
    // Informational bed count; non-negative, capped well above any real lodge.
    bedCapacity: z.number().int().min(0).max(100000).nullable().optional(),
    ...lodgeDetailShape,
    ...lodgePictureShape,
  })
  .strict();
export type OtherLodgeCreateInput = z.infer<typeof otherLodgeCreateSchema>;

/**
 * Client-facing shape returned by the PULL endpoint (`GET /api/v1/other-lodges`).
 * Deliberately omits `sourceClub`: a pulling club only needs
 * the lodge data, not which club submitted it or the internal marker. `id` and
 * `updatedAt` let clients dedupe and sync incrementally.
 */
export interface DistributedOtherLodge extends SerializedLodgeDetail {
  id: string;
  name: string;
  location: string | null;
  bookingOfficerName: string | null;
  bookingOfficerEmail: string | null;
  bookingOfficerPhone: string | null;
  bedCapacity: number | null;
  updatedAt: string;
}

export function serializeOtherLodgeForClient(
  lodge: OtherLodgeRecord,
): DistributedOtherLodge {
  return {
    id: lodge.id,
    name: lodge.name,
    location: lodge.location,
    bookingOfficerName: lodge.bookingOfficerName,
    bookingOfficerEmail: lodge.bookingOfficerEmail,
    bookingOfficerPhone: lodge.bookingOfficerPhone,
    bedCapacity: lodge.bedCapacity,
    ...serializeLodgeDetail(lodge),
    updatedAt: lodge.updatedAt.toISOString(),
  };
}

// A single lodge entry a client uploads. Provenance (`sourceClub`) is never
// accepted from clients; the server stamps it from the authenticated club.
export const otherLodgeUploadItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    location: z.string().trim().max(300).nullable().optional(),
    bookingOfficerName: z.string().trim().max(200).nullable().optional(),
    bookingOfficerEmail: optionalEmail,
    bookingOfficerPhone: z.string().trim().max(50).nullable().optional(),
    bedCapacity: z.number().int().min(0).max(100000).nullable().optional(),
    ...lodgeDetailShape,
  })
  .strict();
export type OtherLodgeUploadItem = z.infer<typeof otherLodgeUploadItemSchema>;

export const otherLodgeUploadSchema = z.object({
  lodges: z.array(otherLodgeUploadItemSchema).min(1).max(500),
});

export const otherLodgeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    location: z.string().trim().max(300).nullable().optional(),
    bookingOfficerName: z.string().trim().max(200).nullable().optional(),
    bookingOfficerEmail: optionalEmail,
    bookingOfficerPhone: z.string().trim().max(50).nullable().optional(),
    bedCapacity: z.number().int().min(0).max(100000).nullable().optional(),
    ...lodgeDetailShape,
    ...lodgePictureShape,
  })
  .strict();
export type OtherLodgeUpdateInput = z.infer<typeof otherLodgeUpdateSchema>;
