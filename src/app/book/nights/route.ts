import { NextResponse } from "next/server";
import { clientIp } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  CHECK_IN_DAYS_AHEAD_MAX,
  addDays,
  isCalendarDate,
  nightsBetween,
  todayInNz,
  toPublicLodge,
} from "@/lib/lodge-search";
import { loadPublicLodgeRecords } from "@/lib/public-lodges";
import { askNights } from "@/lib/bed-planner-data";
import type { HomeNightsResponse } from "@/lib/bed-planner";

/**
 * GET /book/nights?from=YYYY-MM-DD&to=YYYY-MM-DD — free beds at every public
 * lodge for a few nights, for the home page's "this weekend" grid (#25).
 *
 * Public, like /book, and asked of the clubs NOW, never stored. Each request
 * asks every club, and a club's booking site limits how often THIS server may
 * ask (one caller address for every visitor), so this route is careful:
 *
 *  - the home page fetches it from the browser after it loads, so a crawler
 *    that does not run JavaScript never triggers it;
 *  - requests for the same nights that arrive while a round of questions is
 *    already out SHARE that round (nothing is kept once it has answered);
 *  - each caller address gets a few a minute, far fewer than the search;
 *  - a week of nights at most, from today to two years ahead.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The most nights one request may ask about. */
const HOME_NIGHTS_MAX = 7;
/** Requests per caller address per rate-limit window. */
const HOME_NIGHTS_PER_WINDOW = 10;

const noStore = { "Cache-Control": "no-store" };

/** Rounds of questions still out, by nights asked: shared, then forgotten. */
const inFlight = new Map<string, Promise<HomeNightsResponse>>();

async function freeBedsByNight(from: string, to: string): Promise<HomeNightsResponse> {
  // A deleted lodge (#16) is not offered to the public.
  const lodges = (await loadPublicLodgeRecords()).map(toPublicLodge);
  const nights = await askNights(lodges, { from, to, nights: [] }, { checkIn: from, checkOut: to });
  return {
    from,
    to,
    lodges: lodges.map((l) => ({
      id: l.id,
      name: l.name,
      location: l.location,
      nights: Object.fromEntries(nights.get(l.id)?.nights ?? []),
    })),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const today = todayInNz();
  if (
    !isCalendarDate(from) ||
    !isCalendarDate(to) ||
    from < today ||
    from > addDays(today, CHECK_IN_DAYS_AHEAD_MAX) ||
    nightsBetween(from, to) < 1 ||
    nightsBetween(from, to) > HOME_NIGHTS_MAX
  ) {
    return NextResponse.json({ error: "Choose up to a week of nights from today." }, { status: 400, headers: noStore });
  }
  const limit = checkRateLimit(`book:nights:${clientIp(req) ?? "unknown"}`, Date.now(), HOME_NIGHTS_PER_WINDOW);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers: noStore });
  }

  const key = `${from}|${to}`;
  let round = inFlight.get(key);
  if (!round) {
    round = freeBedsByNight(from, to).finally(() => inFlight.delete(key));
    inFlight.set(key, round);
  }
  return NextResponse.json(await round, { headers: noStore });
}
