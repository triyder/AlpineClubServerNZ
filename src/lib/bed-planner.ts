import {
  addDays,
  eachNight,
  nightsBetween,
  totalGuests,
  type GuestCounts,
  type RawSearchParams,
} from "@/lib/lodge-search";
import { schoolHolidayStay } from "@/lib/school-holidays";
import type { ClubAvailability } from "@/lib/club-availability";

/**
 * The bed planner (#25, owner's choice of the "Bed planner" design, 17 Oct
 * 2026): free beds at each lodge night by night, for a window of nights around
 * the guest's stay. Pure: the page asks the clubs and hands the answers in.
 */

/** The fewest nights the grid shows. */
export const PLANNER_MIN_NIGHTS = 7;
/** The most nights one club question may cover (the booking app's cap). */
export const PLANNER_MAX_NIGHTS = 30;
/** Nights shown before arrival, so the guest sees whether moving a day helps. */
export const PLANNER_NIGHTS_BEFORE = 2;
/** Fewer spare beds than this after the party is "only a few beds left". */
export const PLANNER_FEW_SPARE = 4;

export interface PlannerWindow {
  /** First night shown. */
  from: string;
  /** The day after the last night shown. */
  to: string;
  nights: string[];
}

/**
 * The nights the grid shows for a stay: from two nights before arrival (never
 * before today), at least seven, always the whole stay, at most thirty.
 */
export function plannerWindow(checkIn: string, checkOut: string, today: string): PlannerWindow {
  // The search refuses an arrival before today and a stay over thirty nights,
  // so `from` <= `checkIn` and the stay always fits.
  let from = addDays(checkIn, -PLANNER_NIGHTS_BEFORE);
  if (from < today) from = today > checkIn ? checkIn : today;
  let to = addDays(from, PLANNER_MIN_NIGHTS);
  if (to < checkOut) to = checkOut;
  // A long stay: give up nights before arrival rather than nights of the stay.
  if (nightsBetween(from, to) > PLANNER_MAX_NIGHTS) {
    from = addDays(to, -PLANNER_MAX_NIGHTS);
    if (from > checkIn) from = checkIn;
  }
  return { from, to, nights: eachNight(from, to) };
}

/** What the grid knows about one lodge. */
export interface LodgeNights {
  /** Free beds by night, or null when the club did not say night by night. */
  nights: ReadonlyMap<string, number> | null;
  /** The fewest free beds on any night of the STAY, or null when unknown. */
  stayFreeBeds: number | null;
}

/**
 * One lodge's nights from the club's answer for the window, falling back to
 * its answer for the stay alone (an older booking app sends no nights).
 */
export function lodgeNights(
  window: ClubAvailability | undefined,
  stayOnly: ClubAvailability | undefined,
  stay: { checkIn: string; checkOut: string },
): LodgeNights {
  if (window?.nights) {
    const stayNights = eachNight(stay.checkIn, stay.checkOut).map((n) => window.nights!.get(n));
    const known = stayNights.every((n) => n !== undefined);
    return { nights: window.nights, stayFreeBeds: known ? Math.min(...(stayNights as number[])) : null };
  }
  return { nights: null, stayFreeBeds: stayOnly?.freeBeds ?? null };
}

export type NightLevel = "room" | "few" | "short" | "unknown";

/** How one night looks for a party of `guests`. */
export function nightLevel(freeBeds: number | undefined, guests: number): NightLevel {
  if (freeBeds === undefined) return "unknown";
  if (freeBeds < Math.max(1, guests)) return "short";
  if (freeBeds - Math.max(1, guests) < PLANNER_FEW_SPARE) return "few";
  return "room";
}

// Spelled out here rather than by `toLocaleDateString`, whose wording depends on
// the ICU data of wherever it runs: the weekend grid renders on the server and
// again in the browser, and the two must agree.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 18": a night's column heading, read in UTC like every date here. */
export function nightLabel(night: string): { weekday: string; day: string } {
  const d = new Date(`${night}T00:00:00Z`);
  return { weekday: WEEKDAYS[d.getUTCDay()]!, day: String(d.getUTCDate()) };
}

/** "Fri 18 Dec": a night in words. */
export function nightInWords(night: string): string {
  const d = new Date(`${night}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "nights of Fri 18 Dec to Sat 19 Dec" (or one night): the nights a grid shows. */
export function nightsInWords(nights: ReadonlyArray<string>): string {
  const first = nights[0];
  const last = nights[nights.length - 1];
  if (!first || !last) return "";
  return first === last ? `night of ${nightInWords(first)}` : `nights of ${nightInWords(first)} to ${nightInWords(last)}`;
}

/**
 * The weekend quick picks on the home page: Friday to Sunday. On a Saturday
 * "this weekend" is Saturday night only; on a Sunday it is the next weekend.
 */
export function weekendStays(today: string): { thisWeekend: { checkIn: string; checkOut: string }; nextWeekend: { checkIn: string; checkOut: string } } {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  const friday = weekday === 6 ? addDays(today, -1) : addDays(today, (5 - weekday + 7) % 7);
  const sunday = addDays(friday, 2);
  const thisCheckIn = weekday === 6 ? today : friday;
  return {
    thisWeekend: { checkIn: thisCheckIn, checkOut: sunday },
    nextWeekend: { checkIn: addDays(friday, 7), checkOut: addDays(sunday, 7) },
  };
}

/** "2 children", "1 adult": an age group's count in words. */
export function guestWords(group: { label: string; plural: string }, count: number): string {
  return `${count} ${count === 1 ? group.label.toLowerCase() : group.plural}`;
}

/** "1 free bed", "4 free beds". */
export function freeBedsWords(n: number): string {
  return `${n} free ${n === 1 ? "bed" : "beds"}`;
}

/** The guests as one number, at least one (a grid with no party asks about one bed). */
export function partySize(guests: GuestCounts): number {
  return Math.max(1, totalGuests(guests));
}

/** The home page's quick picks (#25), sent to `/book` as `when=<key>`. */
export const QUICK_PICKS = ["this-weekend", "next-weekend", "school-holidays"] as const;
export type QuickPick = (typeof QUICK_PICKS)[number];

/** The stay a quick pick stands for today, or null (no school holidays listed ahead). */
export function quickPickStay(pick: QuickPick, today: string): { checkIn: string; checkOut: string } | null {
  if (pick === "school-holidays") return schoolHolidayStay(today);
  const { thisWeekend, nextWeekend } = weekendStays(today);
  return pick === "this-weekend" ? thisWeekend : nextWeekend;
}

/**
 * A search sent by a quick-pick button: its dates replace whatever the date
 * boxes held (a button press skips the form's own checks), and `when` itself
 * is dropped, so the planner's own links and form carry plain dates.
 */
export function applyQuickPick(params: RawSearchParams, today: string): RawSearchParams {
  const when = Array.isArray(params.when) ? params.when[0] : params.when;
  if (!when || !(QUICK_PICKS as readonly string[]).includes(when)) return params;
  const { when: _dropped, ...rest } = params;
  const stay = quickPickStay(when as QuickPick, today);
  return stay ? { ...rest, checkIn: stay.checkIn, checkOut: stay.checkOut } : rest;
}
