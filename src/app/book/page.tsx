import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
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
import { applyQuickPick, nightsInWords, partySize } from "@/lib/bed-planner";
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

/** The search's own URL with the grid starting at `from` (‹ and ›); no lodge open. */
function weekHref(params: RawSearchParams, from: string): string {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "lodge" || key === "unavailable" || key === "view" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.append(key, v);
  }
  url.set("view", from);
  // Land on the grid, not the top of the page.
  return `/book?${url.toString()}#planner`;
}

/** The price of the stay, or "Ask the club" when it cannot be worked out (the panel says why). */
function stayText(r: PlannerResult): string {
  return r.estimate.total !== null ? formatNzd(r.estimate.total) : "Ask the club";
}

/** Under "Ask the club": how many beds the lodge has, when it has said. */
function stayNote(r: PlannerResult): string | undefined {
  if (r.estimate.total !== null || r.lodge.bedCapacity === null) return undefined;
  return `${r.lodge.bedCapacity} ${r.lodge.bedCapacity === 1 ? "bed" : "beds"} in lodge`;
}

function Planner({
  query,
  params,
  results,
  nights,
  previous,
  next,
}: {
  query: SearchQuery;
  params: RawSearchParams;
  results: PlannerResult[];
  nights: string[];
  previous: string | null;
  next: string | null;
}) {
  const guests = totalGuests(query.guests);
  const wanted = typeof params.lodge === "string" ? params.lodge : undefined;
  // Open only the lodge the address names (a home-page link, or a choice made
  // without JavaScript); otherwise every lodge starts closed.
  const pick = results.find((r) => r.lodge.id === wanted);
  const rows: PlannerRow[] = results.map((r) => ({
    id: r.lodge.id,
    name: r.lodge.name,
    location: r.lodge.location,
    nights: r.availability.nights ? Object.fromEntries(r.availability.nights) : null,
    stayFreeBeds: r.availability.stayFreeBeds,
    stayText: stayText(r),
    stayNote: stayNote(r),
    href: chooseHref(params, r.lodge.id),
  }));
  const stay = eachNight(query.checkIn, query.checkOut);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {results.length} {results.length === 1 ? "lodge" : "lodges"} for {guests}{" "}
        {guests === 1 ? "guest" : "guests"}, {nightsInWords(stay)}. Choose a lodge to open its details and its price night by night.
      </p>
      {wanted !== undefined && !pick ? (
        <p role="status" className="rounded-xl border border-border p-3 text-sm">
          The lodge you chose does not match this search.
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
        previousHref={previous ? weekHref(params, previous) : null}
        nextHref={next ? weekHref(params, next) : null}
      />
    </div>
  );
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const today = todayInNz();
  // The home page's quick picks (This weekend, Next weekend, School holidays).
  const params = applyQuickPick(await searchParams, today);
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
    const view = typeof params.view === "string" ? params.view : undefined;
    const { window, previous, next, results } = await loadPlanner(parsed.query, today, view);
    body =
      results.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          No lodges have room for this group. Try fewer facilities, other dates or a smaller group.
        </p>
      ) : (
        <Planner
          query={parsed.query}
          params={params}
          results={results}
          nights={window.nights}
          previous={previous}
          next={next}
        />
      );
  }

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader current="book" />
      {/* The planner's heading and search over a faded photo of Whakapapa in
          snow (owner, 18 Oct 2026). The photo is decorative (empty alt); its
          credit, which the licence requires, is in the corner. */}
      <section className="relative isolate overflow-hidden">
        <Image
          // By path, not imported: a typecheck without Next's generated image
          // declarations (CI runs it before any build) cannot resolve a .jpg import.
          src="/images/whakapapa-ski-field.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-20 object-cover object-[center_35%] opacity-95"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-background/25 to-background" />
        <div className="mx-auto max-w-6xl space-y-5 px-4 pb-8 pt-16 sm:px-6 sm:pt-24">
          <div className="max-w-2xl rounded-xl bg-background/70 p-4 backdrop-blur-sm">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Bed planner</h1>
            <p className="text-sm text-foreground/80">
              Free beds at club lodges night by night, straight from each club&apos;s booking site. Prices are
              non-member rates in NZD, incl. GST.
            </p>
          </div>
          {unavailable ? (
            <p role="alert" className="rounded-xl border border-warning/60 bg-background p-3 text-sm">
              That lodge has no booking page at the moment. Please choose another lodge.
            </p>
          ) : null}
          <SearchBar form={parsed.form} today={today} />
        </div>
        <p className="absolute right-3 top-2 text-[0.65rem] text-foreground/70">
          Photo:{" "}
          <a href="https://commons.wikimedia.org/wiki/File:Ruapehu_Whakapapa_Skifield_Base.jpg" className="underline">
            Whakapapa ski field
          </a>
          , P. Doyle,{" "}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline">
            CC BY-SA 4.0
          </a>
          , cropped and faded
        </p>
      </section>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <section aria-label="Search results">{body}</section>
        <p className="text-xs text-muted-foreground">
          <Link href="/" className="underline-offset-4 hover:underline">Home</Link>
        </p>
      </main>
    </div>
  );
}
