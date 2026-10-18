import { addDays } from "@/lib/lodge-search";

/**
 * New Zealand state school holidays (#25, the home page's "School holidays"
 * quick pick), first and last day of each break, `YYYY-MM-DD`.
 *
 * Sources: govt.nz "School terms and holidays" (2026) and the 2027 dates the
 * Minister of Education gazetted (as listed by calculate.co.nz), checked
 * 18 Oct 2026. Terms 2 and 3 are fixed nationwide; the summer break's first
 * day is the latest a school may finish Term 4, and its end varies by school,
 * so each summer break runs to the earliest Term 1 start.
 *
 * ADD THE NEXT YEAR when the Ministry publishes it: once the list runs out,
 * the home page simply stops offering the button.
 */
export const SCHOOL_HOLIDAYS: ReadonlyArray<{ name: string; first: string; last: string }> = [
  { name: "Autumn 2026", first: "2026-04-03", last: "2026-04-19" },
  { name: "Winter 2026", first: "2026-07-04", last: "2026-07-19" },
  { name: "Spring 2026", first: "2026-09-26", last: "2026-10-11" },
  { name: "Summer 2026–27", first: "2026-12-19", last: "2027-01-27" },
  { name: "Autumn 2027", first: "2027-04-10", last: "2027-04-26" },
  { name: "Winter 2027", first: "2027-07-03", last: "2027-07-18" },
  { name: "Spring 2027", first: "2027-09-25", last: "2027-10-10" },
  { name: "Summer 2027–28", first: "2027-12-18", last: "2028-01-27" },
];

/** Nights the quick pick searches: the first week of the break. */
export const SCHOOL_HOLIDAY_NIGHTS = 7;

/**
 * The stay the "School holidays" button searches: a week from the first day of
 * the next school holidays, or from today when they have already begun (never
 * past the break's last night). Null when the list has run out.
 */
export function schoolHolidayStay(today: string): { checkIn: string; checkOut: string; name: string } | null {
  const next = SCHOOL_HOLIDAYS.find((h) => h.last >= today);
  if (!next) return null;
  const checkIn = next.first > today ? next.first : today;
  const afterBreak = addDays(next.last, 1);
  const weekLater = addDays(checkIn, SCHOOL_HOLIDAY_NIGHTS);
  const checkOut = weekLater < afterBreak ? weekLater : afterBreak;
  // A break whose last day is today leaves one night (today's).
  return { checkIn, checkOut: checkOut > checkIn ? checkOut : addDays(checkIn, 1), name: next.name };
}
