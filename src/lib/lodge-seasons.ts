/**
 * A lodge's winter and summer seasons (owner decisions, 16 Oct 2026): each a
 * START and an END date. The ONE home of the season rules, read by the public
 * search's estimate and by every save (the admin form and routes, the club
 * upload).
 *
 *  - The dates carry a year, but seasons RECUR every year, so only the month
 *    and day are used; a season may cross New Year (summer 1 Nov to 30 Apr).
 *  - The end date is the season's LAST day (inclusive).
 *  - A season with a start but no end yet runs up to (not including) the
 *    other season's start, which is how seasons worked before end dates.
 *  - A night in neither season has no rate, so the stay has no estimate.
 *  - The two seasons may not share a day, and a season's start and end must be
 *    different days (`seasonDatesProblem`).
 *
 * No `server-only` import: the admin panel checks the dates before a save.
 */

export type Season = "winter" | "summer";

export interface SeasonDates {
  winterSeasonStart?: string | null;
  winterSeasonEnd?: string | null;
  summerSeasonStart?: string | null;
  summerSeasonEnd?: string | null;
}

/** `MM-DD` of a `YYYY-MM-DD` date: seasons recur, so the year is ignored. */
function monthDay(date: string): string {
  return date.slice(5);
}

interface Range {
  start: string;
  end: string;
  /** True for an explicit end date (its last day); false for the fallback. */
  inclusive: boolean;
}

function rangeOf(start?: string | null, end?: string | null, otherStart?: string | null): Range | null {
  if (!start) return null;
  if (end) return { start: monthDay(start), end: monthDay(end), inclusive: true };
  if (otherStart) return { start: monthDay(start), end: monthDay(otherStart), inclusive: false };
  return null;
}

function inRange(day: string, range: Range): boolean {
  const { start, end, inclusive } = range;
  if (start === end) return inclusive ? day === start : false;
  const afterStart = day >= start;
  const beforeEnd = inclusive ? day <= end : day < end;
  // A range whose end comes before its start (in the year) crosses New Year.
  return start < end ? afterStart && beforeEnd : afterStart || beforeEnd;
}

function ranges(dates: SeasonDates): { winter: Range | null; summer: Range | null } {
  return {
    winter: rangeOf(dates.winterSeasonStart, dates.winterSeasonEnd, dates.summerSeasonStart),
    summer: rangeOf(dates.summerSeasonStart, dates.summerSeasonEnd, dates.winterSeasonStart),
  };
}

/** The season a night (`YYYY-MM-DD`) falls in, or null when it is in neither. */
export function seasonForNight(night: string, dates: SeasonDates): Season | null {
  const { winter, summer } = ranges(dates);
  const day = monthDay(night);
  if (winter && inRange(day, winter)) return "winter";
  if (summer && inRange(day, summer)) return "summer";
  return null;
}

/** True when at least one season can be placed (it has a start and an end, or the other's start). */
export function hasSeasons(dates: SeasonDates): boolean {
  const { winter, summer } = ranges(dates);
  return winter !== null || summer !== null;
}

/**
 * A season's days in words, for the public search's rate table: "1 June to
 * 30 September". Without an end date, the day before the other season starts.
 * Null when the season cannot be placed.
 */
export function seasonSpanText(dates: SeasonDates, season: Season): string | null {
  const range = ranges(dates)[season];
  if (!range) return null;
  const last = range.inclusive ? range.end : dayBefore(range.end);
  return `${spoken(range.start)} to ${spoken(last)}`;
}

function dayBefore(day: string): string {
  const at = DAYS_OF_YEAR.indexOf(day);
  return DAYS_OF_YEAR[(at - 1 + DAYS_OF_YEAR.length) % DAYS_OF_YEAR.length] ?? day;
}

/** Every `MM-DD` of a leap year, 29 February included. */
const DAYS_OF_YEAR: string[] = (() => {
  const days: string[] = [];
  for (let d = new Date(Date.UTC(2024, 0, 1)); d.getUTCFullYear() === 2024; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(5, 10));
  }
  return days;
})();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function spoken(day: string): string {
  const [month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}

/**
 * Why these season dates cannot be saved, in words an administrator can act
 * on, or null when they are fine. Checks the seasons as they will be used,
 * the fallback for a missing end included.
 */
export function seasonDatesProblem(dates: SeasonDates): string | null {
  for (const [label, start, end] of [
    ["winter", dates.winterSeasonStart, dates.winterSeasonEnd],
    ["summer", dates.summerSeasonStart, dates.summerSeasonEnd],
  ] as const) {
    if (end && !start) return `The ${label} season has an end date but no start date.`;
    if (start && end && monthDay(start) === monthDay(end)) {
      return `The ${label} season's start and end dates must be different days.`;
    }
  }
  const { winter, summer } = ranges(dates);
  if (!winter || !summer) return null;
  const shared = DAYS_OF_YEAR.find((day) => inRange(day, winter) && inRange(day, summer));
  return shared
    ? `The winter and summer seasons overlap: both include ${spoken(shared)}. Change the dates so each day is in one season at most.`
    : null;
}
