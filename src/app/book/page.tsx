import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { clientIpFromHeaders } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  formatNzd,
  parseSearchParams,
  todayInNz,
  totalGuests,
  type RawSearchParams,
  type SearchQuery,
  eachNight,
} from "@/lib/lodge-search";
import { nightsInWords, partySize } from "@/lib/bed-planner";
import { loadPlanner, type PlannerResult } from "@/lib/bed-planner-data";
import { SearchBar } from "@/components/book/search-form";
import type { PlannerRow } from "@/components/book/bed-planner-grid";
import { ChosenLodgePanel } from "@/components/book/chosen-lodge-panel";
import { PlannerView } from "@/components/book/planner-view";
import { PublicHeader } from "@/components/book/public-header";

/**
 * PUBLIC bed planner (#25, the owner's "Bed planner" design) — no sign-in
 * (listed in PUBLIC_PAGES of the proxy coverage test on purpose). Guests see
 * free beds at each lodge night by night around their stay, choose a lodge,
 * and are sent to its own site to book; this server never makes a booking.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bed planner",
  description: "Free beds at club lodges night by night, priced for your group.",
};

/** The caller's address, read as the API routes read it (`clientIpFromHeaders`). */
async function callerIp(): Promise<string> {
  return clientIpFromHeaders(await headers()) ?? "unknown";
}

/** The search's own URL with one lodge chosen. */
function chooseHref(params: RawSearchParams, lodgeId: string): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "lodge" || key === "unavailable" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.append(key, v);
  }
  url.set("lodge", lodgeId);
  return `/book?${url.toString()}#chosen-lodge`;
}

/** The price of the stay, or "No price" (the panel says why). */
function stayText(r: PlannerResult): string {
  return r.estimate.total !== null ? formatNzd(r.estimate.total) : "No price";
}

/** The lodge the guest chose, else the first with room, else the first. */
function chosen(results: PlannerResult[], wanted: string | undefined): PlannerResult | undefined {
  return (
    results.find((r) => r.lodge.id === wanted) ??
    results.find((r) => r.availableBeds !== null) ??
    results[0]
  );
}

function Planner({
  query,
  params,
  results,
  nights,
}: {
  query: SearchQuery;
  params: RawSearchParams;
  results: PlannerResult[];
  nights: string[];
}) {
  const guests = totalGuests(query.guests);
  const wanted = typeof params.lodge === "string" ? params.lodge : undefined;
  const pick = chosen(results, wanted);
  const rows: PlannerRow[] = results.map((r) => ({
    id: r.lodge.id,
    name: r.lodge.name,
    location: r.lodge.location,
    nights: r.availability.nights ? Object.fromEntries(r.availability.nights) : null,
    stayFreeBeds: r.availability.stayFreeBeds,
    stayText: stayText(r),
    href: chooseHref(params, r.lodge.id),
  }));
  const stay = eachNight(query.checkIn, query.checkOut);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {results.length} {results.length === 1 ? "lodge" : "lodges"} for {guests}{" "}
        {guests === 1 ? "guest" : "guests"}, {nightsInWords(stay)}. Choose a lodge to see its price night by night.
      </p>
      {wanted !== undefined && pick?.lodge.id !== wanted ? (
        <p role="status" className="rounded-xl border border-border p-3 text-sm">
          The lodge you chose does not match this search, so another is shown.
        </p>
      ) : null}
      <PlannerView
        nights={nights}
        stayNights={stay}
        rows={rows}
        guests={partySize(query.guests)}
        caption={`Free beds, ${nightsInWords(nights)}`}
        panels={results.map((r) => ({ id: r.lodge.id, panel: <ChosenLodgePanel result={r} query={query} /> }))}
        initialId={pick?.lodge.id ?? null}
      />
    </div>
  );
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const today = todayInNz();
  const parsed = parseSearchParams(params, today);
  const unavailable = params.unavailable !== undefined;

  let body: React.ReactNode;
  if (parsed.state === "empty") {
    body = (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Choose when you arrive and leave, and who is coming, then press Search.
      </p>
    );
  } else if (parsed.state === "invalid") {
    body = (
      <div role="alert" className="rounded-xl border border-destructive/50 p-4 text-sm text-destructive">
        <ul className="list-inside list-disc space-y-1">
          {parsed.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  } else if (!checkRateLimit(`book:search:${await callerIp()}`).allowed) {
    body = (
      <p role="alert" className="rounded-xl border border-border p-4 text-sm">
        Too many searches in a short time. Please wait a minute and try again.
      </p>
    );
  } else {
    const { window, results } = await loadPlanner(parsed.query, today);
    body =
      results.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          No lodges have room for this group. Try fewer facilities, other dates or a smaller group.
        </p>
      ) : (
        <Planner query={parsed.query} params={params} results={results} nights={window.nights} />
      );
  }

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader current="book" />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Bed planner</h1>
          <p className="text-sm text-muted-foreground">
            Free beds at club lodges night by night, straight from each club&apos;s booking site. Prices are
            non-member rates in NZD, incl. GST.
          </p>
        </div>

        {unavailable ? (
          <p role="alert" className="rounded-xl border border-warning/60 p-3 text-sm">
            That lodge has no booking page at the moment. Please choose another lodge.
          </p>
        ) : null}

        <SearchBar form={parsed.form} today={today} />
        <section aria-label="Search results">{body}</section>
        <p className="text-xs text-muted-foreground">
          <Link href="/" className="underline-offset-4 hover:underline">Home</Link>
        </p>
      </main>
    </div>
  );
}
