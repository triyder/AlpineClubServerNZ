import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  imageRefSelect,
  toImageRef,
  type LodgeImageRef,
} from "@/lib/image-library";
import { NO_CONTROL_CHARS_MESSAGE, noControlChars } from "@/lib/control-chars";

/**
 * Helpers for the central "Other lodges" registry (Admin -> Lodges). Replicates
 * the AlpineClubBookingsNZ registry, plus source-club provenance, which make
 * this the shared source of truth. Every entry is distributed to every club.
 */

/**
 * The lodge detail columns added in API version 1.1, in THREE lists that are
 * the single source of every other shape here: the Prisma select, the
 * serialised types and serialisers, the boolean and date parts of the
 * validation shape, the writers' column builder and the admin panel's
 * facility checkboxes are all derived from them. Adding a column means adding
 * it to one list; the census at the bottom of this block is what makes a
 * column added to `schema.prisma` but to neither list nor the excused set a
 * type error rather than a silent omission.
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
  "skiWorkshopArea",
  "gamesRoom",
] as const;
export const LODGE_TEXT_FIELDS = [
  "siteUrl",
  "cancellationPeriod",
] as const;
export const LODGE_DATE_FIELDS = [
  "winterSeasonStart",
  "summerSeasonStart",
] as const;

/** Whole-number detail columns: bed counts and the walk to the lodge. */
export const LODGE_INT_FIELDS = [
  "doubleBeds",
  "singleBeds",
  "minutesWalkToLodge",
] as const;
/** Whether guests sleep in private rooms or dormitories. */
export const LODGE_ROOM_TYPES = ["ROOM", "DORMITORY"] as const;
export type LodgeRoomTypeValue = (typeof LODGE_ROOM_TYPES)[number];

export type LodgeBooleanField = (typeof LODGE_BOOLEAN_FIELDS)[number];
export type LodgeTextField = (typeof LODGE_TEXT_FIELDS)[number];
export type LodgeDateField = (typeof LODGE_DATE_FIELDS)[number];
export type LodgeIntField = (typeof LODGE_INT_FIELDS)[number];
export type LodgeDetailField =
  | LodgeBooleanField
  | LodgeTextField
  | LodgeDateField
  | LodgeIntField
  | "roomType";

/** `{ a: value, b: value }` for a list of keys, typed by the key union. */
function forKeys<K extends string, V>(
  keys: ReadonlyArray<K>,
  value: (key: K) => V,
): { [P in K]: V } {
  return Object.fromEntries(keys.map((k) => [k, value(k)])) as { [P in K]: V };
}

const LODGE_DETAIL_SELECT = forKeys<LodgeDetailField, true>(
  [
    ...LODGE_TEXT_FIELDS,
    ...LODGE_BOOLEAN_FIELDS,
    ...LODGE_DATE_FIELDS,
    ...LODGE_INT_FIELDS,
    "roomType",
  ],
  () => true,
);

/**
 * Every `OtherLodge` column that is deliberately NOT a detail field: identity,
 * contact and capacity, the picture foreign keys, provenance and timestamps.
 */
const EXCUSED_OTHER_LODGE_COLUMNS = [
  "id",
  "name",
  "location",
  "bookingOfficerName",
  "bookingOfficerEmail",
  "bookingOfficerPhone",
  "bedCapacity",
  "imageId",
  "logoId",
  "sourceClubId",
  "lastUpdatedByClubId",
  "lastUploadedAt",
  "createdAt",
  "updatedAt",
] as const;

type OtherLodgeColumn = Prisma.OtherLodgeScalarFieldEnum;
type UnlistedOtherLodgeColumn = Exclude<
  OtherLodgeColumn,
  LodgeDetailField | (typeof EXCUSED_OTHER_LODGE_COLUMNS)[number]
>;

/**
 * The type-level census. `Record<never, never>` is `{}`, so this compiles
 * exactly when every column of the Prisma model is in one of the three lists
 * or the excused set; a new column makes the next line fail to type-check,
 * naming the column. Exported so a test can also pin it as empty.
 */
export const UNLISTED_OTHER_LODGE_COLUMNS: Record<UnlistedOtherLodgeColumn, never> = {};

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

/**
 * The detail fields as they leave the server, to admins and to clubs alike:
 * text as stored or null, booleans as booleans, the dates as calendar
 * `YYYY-MM-DD` strings or null, plus the amenity list.
 */
export type SerializedLodgeDetail = { [K in LodgeTextField]: string | null } & {
  [K in LodgeBooleanField]: boolean;
} & { [K in LodgeDateField]: string | null } & {
  [K in LodgeIntField]: number | null;
} & { roomType: LodgeRoomTypeValue | null } & { amenities: LodgeAmenity[] };

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
    ...forKeys(LODGE_TEXT_FIELDS, (key) => lodge[key]),
    ...forKeys(LODGE_BOOLEAN_FIELDS, (key) => lodge[key]),
    ...forKeys(LODGE_DATE_FIELDS, (key) => formatLodgeDate(lodge[key])),
    ...forKeys(LODGE_INT_FIELDS, (key) => lodge[key]),
    roomType: lodge.roomType,
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

/**
 * A single-line text field: trimmed, bounded, no control characters. The
 * control-character refinement is a `.refine`, which the contract fingerprint
 * (a JSON Schema of the upload shape) does not see, so adding it is not a
 * contract change.
 */
function lineText(max: number, min = 0) {
  const bounded = min > 0 ? z.string().trim().min(min) : z.string().trim();
  return bounded.max(max).refine(noControlChars, NO_CONTROL_CHARS_MESSAGE);
}

// An optional email that treats blank input as "not set": the admin form sends
// "" for a cleared field, and "" is not a valid email — fold it to null before
// the format check so clearing the field is not a validation error.
const optionalEmail = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(320)
    .email()
    .refine(noControlChars, NO_CONTROL_CHARS_MESSAGE)
    .nullable()
    .optional(),
);

/**
 * A lodge's website address as it may be stored and handed to every club, where
 * it is rendered as a link. The WHATWG parser alone is too forgiving: it reads
 * `http:\\evil.com` and `https:/\t/evil.com` as `https://evil.com`, and
 * accepts `https://club.nz@evil.com`, whose "club.nz" is a username that a
 * reader takes for the host. So the RAW text is checked, and stored as typed:
 *
 *  - it starts with `http://` or `https://` (any case);
 *  - it carries no whitespace, control character or backslash;
 *  - parsed, it has no username or password.
 */
export function isSafeHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/[\s\u0000-\u001F\u007F\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * The key two lodge names are compared on for "too similar to tell apart":
 * NFKC-folded (full-width and compatibility characters to their plain forms),
 * every format and control character removed (zero-width space and joiners,
 * word joiner, BOM), every kind of whitespace removed (NBSP included) and
 * lower-cased. The unique index is exact and case-sensitive, so without this a
 * club could upload "Ruapehu Lodge" with a zero-width space in it and have a
 * convincing duplicate distributed to every club.
 *
 * What it does NOT fold: homoglyphs from other scripts (a Cyrillic "а" for a
 * Latin "a"), which NFKC leaves alone.
 */
export function normalizeLodgeNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .replace(/\s/gu, "")
    .toLowerCase();
}

/**
 * The stored name whose key equals `name`'s but whose spelling differs, or
 * null. An exact match is NOT reported: that is the unique index's job (and
 * the upload's "owned" paths). Application-level and therefore race-prone by
 * design — two lookalikes created in the same instant both pass; only the
 * exact-name index is atomic — which is accepted, because the alternative is
 * a schema change (a generated normalised column with its own unique index).
 */
export function findSimilarLodgeName(
  name: string,
  existingNames: Iterable<string>,
): string | null {
  const key = normalizeLodgeNameKey(name);
  for (const existing of existingNames) {
    if (existing !== name && normalizeLodgeNameKey(existing) === key) {
      return existing;
    }
  }
  return null;
}

export function similarLodgeNameMessage(existing: string): string {
  return `A lodge named "${existing}" already exists; the new name is too similar to be told apart.`;
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
export const AMENITY_NAME_MAX = 120;
export const AMENITY_DESCRIPTION_MAX = 1000;

export const amenityInputSchema = z
  .object({
    name: lineText(AMENITY_NAME_MAX, 1),
    description: z.preprocess(
      blankToNull,
      lineText(AMENITY_DESCRIPTION_MAX).nullable().optional(),
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
/** A non-negative whole number, or null for "not set". */
const lodgeCountField = z
  .number()
  .int()
  .min(0)
  .max(100000)
  .nullable()
  .optional();

/** Column width of each text detail field; a missing key is a type error. */
const LODGE_TEXT_FIELD_MAX: Record<LodgeTextField, number> = {
  siteUrl: 500,
  cancellationPeriod: 200,
};

/**
 * The detail fields, shared by the admin create/update schemas and the club
 * upload item so all three accept exactly the same values. Every one is
 * optional: omitted means "leave as it is" on an update.
 *
 * The boolean and date entries are derived from their lists. The three text
 * entries are written out because each has its own rule (the site URL is an
 * address, the other two plain text with their own widths), and KEY ORDER IS
 * PART OF THE CONTRACT FINGERPRINT — the JSON Schema of the upload shape is
 * hashed as emitted — so the order here (text, booleans, text, dates,
 * amenities) must not change. The `satisfies` below is what turns a detail
 * field missing from, or foreign to, this shape into a type error.
 */
export const lodgeDetailShape = {
  siteUrl: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(LODGE_TEXT_FIELD_MAX.siteUrl)
      .refine(
        isSafeHttpUrl,
        "Booking page URL must start with http:// or https:// and name only a host and path",
      )
      .nullable()
      .optional(),
  ),
  ...forKeys(LODGE_INT_FIELDS, () => lodgeCountField),
  roomType: z.enum(LODGE_ROOM_TYPES).nullable().optional(),
  ...forKeys(LODGE_BOOLEAN_FIELDS, () => z.boolean().optional()),
  cancellationPeriod: lineText(LODGE_TEXT_FIELD_MAX.cancellationPeriod)
    .nullable()
    .optional(),
  ...forKeys(LODGE_DATE_FIELDS, () => dateOnlyField),
  /** When present, REPLACES the lodge's whole amenity set. */
  amenities: amenitiesInputSchema.optional(),
} satisfies Record<LodgeDetailField | "amenities", z.ZodType>;

type LodgeDetailInput = { [K in LodgeTextField]?: string | null } & {
  [K in LodgeBooleanField]?: boolean;
} & { [K in LodgeDateField]?: string | null } & {
  [K in LodgeIntField]?: number | null;
} & { roomType?: LodgeRoomTypeValue | null };

export type LodgeDetailColumns = { [K in LodgeTextField]?: string | null } & {
  [K in LodgeBooleanField]?: boolean;
} & { [K in LodgeDateField]?: Date | null } & {
  [K in LodgeIntField]?: number | null;
} & { roomType?: LodgeRoomTypeValue | null };

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
  for (const key of LODGE_INT_FIELDS) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.roomType !== undefined) data.roomType = input.roomType;
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

export const LODGE_NAME_MAX = 120;

/** The contact and capacity fields, identical on create, update and upload. */
const lodgeContactShape = {
  location: lineText(300).nullable().optional(),
  bookingOfficerName: lineText(200).nullable().optional(),
  bookingOfficerEmail: optionalEmail,
  bookingOfficerPhone: lineText(50).nullable().optional(),
  // Informational bed count; non-negative, capped well above any real lodge.
  bedCapacity: z.number().int().min(0).max(100000).nullable().optional(),
};

const lodgeNameField = lineText(LODGE_NAME_MAX, 1);

export const otherLodgeCreateSchema = z
  .object({
    name: lodgeNameField,
    ...lodgeContactShape,
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
 *
 * ALSO OMITS `bookingOfficerPhone`, on purpose (#11). It is a private person's
 * number, given to one club; sending it in every pull stored it, unseen, in every
 * other club's database. It is still held here, editable on the Lodges screen and
 * accepted on upload — it is just not handed out. A club never needs it back:
 * it holds its own lodge's number locally.
 */
export interface DistributedOtherLodge extends SerializedLodgeDetail {
  id: string;
  name: string;
  location: string | null;
  bookingOfficerName: string | null;
  bookingOfficerEmail: string | null;
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
    bedCapacity: lodge.bedCapacity,
    ...serializeLodgeDetail(lodge),
    updatedAt: lodge.updatedAt.toISOString(),
  };
}

/**
 * What `GET /api/v1/other-lodges` returns, built in ONE place so the contract
 * fingerprint covers it and a field cannot be added to the response without the
 * version moving.
 *
 * `ownLodgeNames` is the lodges the AUTHENTICATED club owns (set by an
 * administrator on /clubs). It is sent on every pull, incremental or not,
 * because it is the club's whole current list and not a delta: a lodge that was
 * unticked has not changed, so no incremental row would ever announce its loss.
 * By NAME, because that is how the booking site keys its own copy.
 */
export function buildOtherLodgePullEnvelope(input: {
  lodges: DistributedOtherLodge[];
  cursor: string | null;
  ownLodgeNames: string[];
}) {
  return {
    lodges: input.lodges,
    cursor: input.cursor,
    count: input.lodges.length,
    ownLodgeNames: input.ownLodgeNames,
  };
}

// A single lodge entry a client uploads. Provenance (`sourceClub`) is never
// accepted from clients; the server stamps it from the authenticated club.
export const otherLodgeUploadItemSchema = z
  .object({
    name: lodgeNameField,
    ...lodgeContactShape,
    ...lodgeDetailShape,
  })
  .strict();
export type OtherLodgeUploadItem = z.infer<typeof otherLodgeUploadItemSchema>;

export const otherLodgeUploadSchema = z.object({
  lodges: z.array(otherLodgeUploadItemSchema).min(1).max(500),
});

export const otherLodgeUpdateSchema = z
  .object({
    name: lodgeNameField.optional(),
    ...lodgeContactShape,
    ...lodgeDetailShape,
    ...lodgePictureShape,
  })
  .strict();
export type OtherLodgeUpdateInput = z.infer<typeof otherLodgeUpdateSchema>;
