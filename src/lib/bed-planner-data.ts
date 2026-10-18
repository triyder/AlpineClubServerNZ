import { fetchFreeBeds, loadAvailabilityTargets } from "@/lib/club-availability";
import { lodgeNights, plannerView, type LodgeNights, type PlannerWindow } from "@/lib/bed-planner";
import { searchLodges, toPublicLodge, type PublicLodge, type SearchQuery, type SearchResult } from "@/lib/lodge-search";
import { loadLodgeIdsWithEmail, loadPublicLodgeRecords } from "@/lib/public-lodges";

/**
 * What the bed planner shows (#25), asked of the clubs NOW and never stored
 * (as the search always has been): one question per lodge, for the grid's
 * whole window. A club whose answer has no night-by-night list (an older
 * booking app) is asked again for the stay alone, so its lodge still gets the
 * stay's free beds; its cells show "?".
 */

export interface PlannerResult extends SearchResult {
  availability: LodgeNights;
}

export interface Planner {
  /** The nights the grid shows. */
  window: PlannerWindow;
  /** The first night shown after ‹ or ›, or null where the grid cannot go. */
  previous: string | null;
  next: string | null;
  results: PlannerResult[];
}

/** Free beds for `lodges` over `window`, by lodge id, with the stay fallback. */
export async function askNights(
  lodges: ReadonlyArray<PublicLodge>,
  window: PlannerWindow,
  stay: { checkIn: string; checkOut: string },
): Promise<Map<string, LodgeNights>> {
  const targets = await loadAvailabilityTargets(lodges.map((l) => l.id));
  const answers = await fetchFreeBeds(targets, { from: window.from, to: window.to });
  const sameRange = window.from === stay.checkIn && window.to === stay.checkOut;
  // Only a club that ANSWERED without nights is asked again: one that did not
  // answer at all would most likely time out a second time, doubling the wait.
  const needStay = sameRange
    ? []
    : targets.filter((t) => {
        const answer = answers.get(t.lodgeId);
        return answer !== undefined && answer.nights === null;
      });
  const stayAnswers = needStay.length > 0
    ? await fetchFreeBeds(needStay, { from: stay.checkIn, to: stay.checkOut })
    : new Map();
  return new Map(
    lodges.map((l) => {
      const answer = answers.get(l.id);
      return [l.id, lodgeNights(answer, sameRange ? answer : stayAnswers.get(l.id), stay)];
    }),
  );
}

/**
 * The planner's three groups (owner, 18 Oct 2026):
 *  0. lodges a guest can reach (a booking page or an officer's email) with a
 *     price for the stay ($0.00 is a price);
 *  1. reachable lodges whose price is unknown;
 *  2. lodges with neither a booking page nor an email, which the page hides
 *     behind "Display all lodges".
 */
export function plannerGroup(r: SearchResult): 0 | 1 | 2 {
  if (!r.lodge.reachable) return 2;
  return r.estimate.total !== null ? 0 : 1;
}

/** The planner's order: by group (`plannerGroup`), each A to Z by name (ties by id, so it is stable). */
export function plannerOrder(a: SearchResult, b: SearchResult): number {
  const group = plannerGroup(a) - plannerGroup(b);
  if (group !== 0) return group;
  return a.lodge.name.localeCompare(b.lodge.name, "en-NZ", { sensitivity: "base" }) || a.lodge.id.localeCompare(b.lodge.id);
}

/** The planner for a valid search. */
export async function loadPlanner(query: SearchQuery, today: string, view?: string): Promise<Planner> {
  const { window, ask, previous, next } = plannerView(query.checkIn, query.checkOut, today, view);
  // A deleted lodge (#16) is not offered to the public.
  const records = (await loadPublicLodgeRecords()).map(toPublicLodge);
  // A lodge with an officer's email is reachable too (third group: neither).
  const withEmail = await loadLodgeIdsWithEmail(records.filter((l) => !l.reachable).map((l) => l.id));
  const lodges = records.map((l) => (withEmail.has(l.id) ? { ...l, reachable: true } : l));
  // Only lodges that already fit the party and the ticked facilities are asked.
  const candidates = searchLodges(lodges, query).map((r) => r.lodge);
  // The grid's nights and the stay's together (`ask`), so the stay's free
  // beds are known wherever the grid has been moved to.
  const nights = await askNights(candidates, { ...ask, nights: [] }, query);
  const known = new Map(
    [...nights].flatMap(([id, n]) => (n.stayFreeBeds === null ? [] : [[id, n.stayFreeBeds] as const])),
  );
  const results = searchLodges(lodges, query, known)
    .map((r) => ({
      ...r,
      availability: nights.get(r.lodge.id) ?? { nights: null, stayFreeBeds: null },
    }))
    .sort(plannerOrder);
  return { window, previous, next, results };
}
