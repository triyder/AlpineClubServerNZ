import type { Prisma } from "@prisma/client";
import { imageRefSelect, toImageRef } from "@/lib/image-library";
import { hasSeasons, seasonForNight, type Season } from "@/lib/lodge-seasons";
import {
  formatLodgeDate,
  LODGE_BOOLEAN_FIELDS,
  LODGE_DATE_FIELDS,
  LODGE_RATE_FIELDS,
  rateToNumber,
  type LodgeBooleanField,
  type LodgeRateField,
} from "@/lib/other-lodges";

/**
 * The public booking search (`/book`): what a guest may see of a lodge, how a
 * search is read from the URL, which lodges it keeps, and the price estimate.
 *
 * THIS SERVER NEVER MAKES A BOOKING. A guest picks a lodge here and is sent to
 * that lodge's own booking site (see `/book/go/[lodgeId]`).
 *
 * Everything below is pure apart from the Prisma select, so the rules are
 * tested without a database. See docs/booking-search-plan.md, Phase B.
 */

// ---------------------------------------------------------------------------
// The public shape. PRIVACY BY CONSTRUCTION: the select names only what a guest
// may see, so a booking officer's name, email or phone, the owning or
// last-updating club, and every audit field are never even read. The booking
// URL is not sent either: "Book with the club" goes through the redirect route, which
// looks it up at the moment of the click.
// ---------------------------------------------------------------------------

/** `{ a: true, b: true }` for a list of columns, typed by the key union. */
function selectAll<K extends string>(keys: ReadonlyArray<K>): { [P in K]: true } {
  return Object.fromEntries(keys.map((k) => [k, true])) as { [P in K]: true };
}

export const publicLodgeSelect = {
  id: true,
  name: true,
  location: true,
  bedCapacity: true,
  doubleBeds: true,
  singleBeds: true,
  cancellationPeriod: true,
  siteUrl: true,
  ...selectAll(LODGE_DATE_FIELDS),
  ...selectAll(LODGE_BOOLEAN_FIELDS),
  ...selectAll(LODGE_RATE_FIELDS),
  amenities: {
    select: { name: true, description: true },
    orderBy: { name: "asc" },
  },
  image: { select: imageRefSelect },
  logo: { select: imageRefSelect },
} as const satisfies Prisma.OtherLodgeSelect;

export type PublicLodgeRecord = Prisma.OtherLodgeGetPayload<{
  select: typeof publicLodgeSelect;
}>;

export interface PublicLodgePicture {
  url: string;
  /** Which picture this is: the lodge image, or its logo standing in. */
  kind: "image" | "logo";
}

export interface PublicLodge {
  id: string;
  name: string;
  location: string | null;
  /** "Total beds": the lodge's bed capacity. */
  bedCapacity: number | null;
  doubleBeds: number | null;
  singleBeds: number | null;
  cancellationPeriod: string | null;
  /** True when the lodge has a booking page to send a guest to. */
  canBook: boolean;
  /** The facilities the lodge has, in the fixed list order. */
  facilities: LodgeBooleanField[];
  amenities: Array<{ name: string; description: string | null }>;
  rates: Record<LodgeRateField, number | null>;
  winterSeasonStart: string | null;
  winterSeasonEnd: string | null;
  summerSeasonStart: string | null;
  summerSeasonEnd: string | null;
  /** The lodge image, else its logo, else null (the page shows "No image"). */
  picture: PublicLodgePicture | null;
}

export function toPublicLodge(record: PublicLodgeRecord): PublicLodge {
  const image = toImageRef(record.image);
  const logo = toImageRef(record.logo);
  return {
    id: record.id,
    name: record.name,
    location: record.location,
    bedCapacity: record.bedCapacity,
    doubleBeds: record.doubleBeds,
    singleBeds: record.singleBeds,
    cancellationPeriod: record.cancellationPeriod,
    canBook: Boolean(record.siteUrl),
    facilities: LODGE_BOOLEAN_FIELDS.filter((key) => record[key]),
    amenities: record.amenities.map((a) => ({
      name: a.name,
      description: a.description,
    })),
    rates: Object.fromEntries(
      LODGE_RATE_FIELDS.map((key) => [key, rateToNumber(record[key])]),
    ) as Record<LodgeRateField, number | null>,
    winterSeasonStart: formatLodgeDate(record.winterSeasonStart),
    winterSeasonEnd: formatLodgeDate(record.winterSeasonEnd),
    summerSeasonStart: formatLodgeDate(record.summerSeasonStart),
    summerSeasonEnd: formatLodgeDate(record.summerSeasonEnd),
    picture: image
      ? { url: image.url, kind: "image" }
      : logo
        ? { url: logo.url, kind: "logo" }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Guests. Guideline age groups only: the real ages are entered on the lodge's
// own site when the booking is made.
// ---------------------------------------------------------------------------

export const AGE_GROUPS = [
  { key: "under5", label: "Infant", plural: "infants", winter: "winterRateUnder5", summer: "summerRateUnder5" },
  { key: "age5to11", label: "Child", plural: "children", winter: "winterRate5To11", summer: "summerRate5To11" },
  { key: "age12to17", label: "Youth", plural: "youth", winter: "winterRate12To17", summer: "summerRate12To17" },
  { key: "adults", label: "Adult", plural: "adults", winter: "winterRateAdult", summer: "summerRateAdult" },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  plural: string;
  winter: LodgeRateField;
  summer: LodgeRateField;
}>;

export type AgeGroupKey = (typeof AGE_GROUPS)[number]["key"];

/**
 * The guest boxes in the order both search forms show them (owner, 18 Oct
 * 2026): adults first, as most parties are, then Youth, Children, Infants.
 */
export const GUEST_FIELDS = [...AGE_GROUPS].reverse();

/** A guest box's label: "Adults", "Youth", "Children", "Infants". */
export function guestFieldLabel(group: { plural: string }): string {
  return group.plural.charAt(0).toUpperCase() + group.plural.slice(1);
}
export type GuestCounts = Record<AgeGroupKey, number>;

export const GUESTS_PER_GROUP_MAX = 50;
export const GUESTS_TOTAL_MAX = 50;
export const STAY_NIGHTS_MAX = 30;
/** How far ahead a stay may start. */
export const CHECK_IN_DAYS_AHEAD_MAX = 730;

export function totalGuests(guests: GuestCounts): number {
  return AGE_GROUPS.reduce((sum, g) => sum + guests[g.key], 0);
}

// ---------------------------------------------------------------------------
// Calendar dates. Plain `YYYY-MM-DD` strings throughout, done in UTC, so no
// date ever shifts by the server's time zone. "Today" is New Zealand's.
// ---------------------------------------------------------------------------

/** Today's date in New Zealand, `YYYY-MM-DD`. */
export function todayInNz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** Whole nights from check-in to check-out. */
/** `YYYY-MM-DD` plus `days`, in UTC (calendar arithmetic only). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return dayNumber(checkOut) - dayNumber(checkIn);
}

/** Each night of the stay, by the date it starts: check-in up to check-out. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const start = dayNumber(checkIn);
  return Array.from({ length: nightsBetween(checkIn, checkOut) }, (_, i) =>
    new Date((start + i) * 86_400_000).toISOString().slice(0, 10),
  );
}

// ---------------------------------------------------------------------------
// Reading a search from the URL. The search lives in the query string, so a
// result page can be bookmarked or shared.
// ---------------------------------------------------------------------------

export interface SearchQuery {
  checkIn: string;
  checkOut: string;
  guests: GuestCounts;
  facilities: LodgeBooleanField[];
}

/** What the form shows: the values as typed, valid or not. */
export interface SearchFormValues {
  checkIn: string;
  checkOut: string;
  guests: Record<AgeGroupKey, string>;
  facilities: LodgeBooleanField[];
}

export type ParsedSearch =
  | { state: "empty"; form: SearchFormValues }
  | { state: "invalid"; form: SearchFormValues; errors: string[] }
  | { state: "ok"; form: SearchFormValues; query: SearchQuery };

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function all(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Two adults until the guest says otherwise. */
const DEFAULT_GUESTS: Record<AgeGroupKey, string> = {
  under5: "0",
  age5to11: "0",
  age12to17: "0",
  adults: "2",
};

export function parseSearchParams(
  params: RawSearchParams,
  today: string,
): ParsedSearch {
  // Unknown facility names are ignored rather than refused: an old bookmark
  // must still open.
  const facilities = LODGE_BOOLEAN_FIELDS.filter((key) =>
    all(params.facility).includes(key),
  );

  const form: SearchFormValues = {
    checkIn: first(params.checkIn),
    checkOut: first(params.checkOut),
    guests: Object.fromEntries(
      AGE_GROUPS.map((g) => [
        g.key,
        params[g.key] === undefined ? DEFAULT_GUESTS[g.key] : first(params[g.key]),
      ]),
    ) as Record<AgeGroupKey, string>,
    facilities,
  };

  if (form.checkIn === "" && form.checkOut === "") {
    return { state: "empty", form };
  }

  const errors: string[] = [];
  const { checkIn, checkOut } = form;
  const datesValid = isCalendarDate(checkIn) && isCalendarDate(checkOut);
  if (!datesValid) {
    errors.push("Choose the day you arrive and the day you leave.");
  } else {
    const nights = nightsBetween(checkIn, checkOut);
    if (checkIn < today) errors.push("You cannot arrive in the past.");
    if (nights < 1) errors.push("You must leave after the day you arrive.");
    if (nights > STAY_NIGHTS_MAX) {
      errors.push(`A stay can be at most ${STAY_NIGHTS_MAX} nights.`);
    }
    if (dayNumber(checkIn) - dayNumber(today) > CHECK_IN_DAYS_AHEAD_MAX) {
      errors.push("That arrival is too far ahead.");
    }
  }

  const guests = {} as GuestCounts;
  let guestsValid = true;
  for (const g of AGE_GROUPS) {
    const raw = form.guests[g.key];
    const n = raw === "" ? 0 : Number(raw);
    if (!/^\d*$/.test(raw) || n > GUESTS_PER_GROUP_MAX) {
      guestsValid = false;
    }
    guests[g.key] = n;
  }
  if (!guestsValid) {
    errors.push(`Guest numbers must be whole numbers from 0 to ${GUESTS_PER_GROUP_MAX}.`);
  } else {
    const total = totalGuests(guests);
    if (total < 1) errors.push("Add at least one guest.");
    if (total > GUESTS_TOTAL_MAX) {
      errors.push(`A search can be for at most ${GUESTS_TOTAL_MAX} guests.`);
    }
  }

  if (errors.length > 0) return { state: "invalid", form, errors };
  return { state: "ok", form, query: { checkIn, checkOut, guests, facilities } };
}

// ---------------------------------------------------------------------------
// Seasons and the price estimate. Which season a night is in lives in
// `@/lib/lodge-seasons` (start and end dates, recurring every year); a night
// in neither season has no rate, so the stay has no estimate.
// ---------------------------------------------------------------------------

export { seasonForNight, type Season } from "@/lib/lodge-seasons";

export interface StayEstimate {
  nights: number;
  /** Dollars for the whole party and stay, incl. GST; null when unknown. */
  total: number | null;
  /** Why there is no total: a night outside the lodge's seasons, or a missing rate or season. */
  missing?: "out-of-season" | "incomplete";
}

export interface NightPrice {
  night: string;
  season: Season | null;
  /** Each age group with guests: how many, at what nightly rate (dollars, or null when unset). */
  parts: Array<{ label: string; plural: string; count: number; rate: number | null }>;
  /** Whole cents for the party that night, or null when the night has no season or a rate is unset. */
  cents: number | null;
}

/**
 * The stay priced night by night at each night's season rates: THE one
 * pricing of a stay, which the total (`estimateStay`) and the bed planner's
 * night-by-night rows both read, so the rows always add up to the total.
 * In whole cents, so no float error accumulates.
 */
export function priceNights(lodge: PublicLodge, query: SearchQuery): NightPrice[] {
  return eachNight(query.checkIn, query.checkOut).map((night) => {
    const season = seasonForNight(night, lodge);
    const parts = AGE_GROUPS.filter((g) => query.guests[g.key] > 0).map((g) => ({
      label: g.label,
      plural: g.plural,
      count: query.guests[g.key],
      rate: season ? lodge.rates[g[season]] : null,
    }));
    const complete = season !== null && parts.every((p) => p.rate !== null);
    const cents = complete ? parts.reduce((sum, p) => sum + Math.round(p.rate! * 100) * p.count, 0) : null;
    return { night, season, parts, cents };
  });
}

/**
 * The whole stay's price: the sum of `priceNights`. Unknown (null) when a
 * night is outside the lodge's seasons, the lodge has no seasons, or a rate
 * is missing for an age group that has guests.
 */
export function estimateStay(lodge: PublicLodge, query: SearchQuery): StayEstimate {
  const nights = priceNights(lodge, query);
  if (nights.some((n) => n.season === null)) {
    return { nights: nights.length, total: null, missing: hasSeasons(lodge) ? "out-of-season" : "incomplete" };
  }
  if (nights.some((n) => n.cents === null)) return { nights: nights.length, total: null, missing: "incomplete" };
  return { nights: nights.length, total: nights.reduce((sum, n) => sum + n.cents!, 0) / 100 };
}

// ---------------------------------------------------------------------------
// Matching. A lodge is HIDDEN when its total beds are fewer than the guests,
// when it lacks a ticked facility, or when its availability is KNOWN and the
// free beds are fewer than the guests. Unknown availability never hides a
// lodge on its own; such lodges sort after those whose availability is known.
// ---------------------------------------------------------------------------

export interface SearchResult {
  lodge: PublicLodge;
  /** Free beds for the whole stay, or null for "beds available unknown". */
  availableBeds: number | null;
  estimate: StayEstimate;
}

/**
 * @param availability free beds for the stay, by lodge id. A lodge that is not
 *   in the map is "unknown". (Filled from the clubs' booking apps in Phase D.)
 */
export function searchLodges(
  lodges: ReadonlyArray<PublicLodge>,
  query: SearchQuery,
  availability: ReadonlyMap<string, number> = new Map(),
): SearchResult[] {
  const guests = totalGuests(query.guests);
  return lodges
    .filter((lodge) => lodge.bedCapacity === null || lodge.bedCapacity >= guests)
    .filter((lodge) => query.facilities.every((f) => lodge.facilities.includes(f)))
    .map((lodge) => ({
      lodge,
      availableBeds: availability.get(lodge.id) ?? null,
      estimate: estimateStay(lodge, query),
    }))
    .filter((r) => r.availableBeds === null || r.availableBeds >= guests)
    .sort((a, b) => {
      const known = Number(b.availableBeds !== null) - Number(a.availableBeds !== null);
      return known !== 0 ? known : a.lodge.name.localeCompare(b.lodge.name);
    });
}

/** `$1,234.50` — NZD, two places. */
export function formatNzd(dollars: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
  }).format(dollars);
}
