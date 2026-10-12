import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { otherLodgeOrderBy } from "@/lib/other-lodges";
import {
  parseSearchParams,
  publicLodgeSelect,
  searchLodges,
  todayInNz,
  toPublicLodge,
  totalGuests,
  type RawSearchParams,
} from "@/lib/lodge-search";
import { FacilityFilter, SearchBar } from "@/components/book/search-form";
import { LodgeResults } from "@/components/book/lodge-results";

/**
 * PUBLIC booking search — no sign-in (listed in PUBLIC_PAGES of the proxy
 * coverage test on purpose). Guests search the lodge registry and are sent to
 * the chosen lodge's own site to book; this server never makes a booking.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find a lodge",
  description: "Search alpine club lodges by date, guests and facilities.",
};

/** Same source of the caller's address as the API routes (`clientIp`). */
async function callerIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip")) ?? "unknown";
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
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
        Choose your dates and guests, then press Search.
      </p>
    );
  } else if (parsed.state === "invalid") {
    body = (
      <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">
        <ul className="list-inside list-disc space-y-1">
          {parsed.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  } else if (!checkRateLimit(`book:search:${await callerIp()}`).allowed) {
    body = (
      <p role="alert" className="rounded-lg border border-border p-4 text-sm">
        Too many searches in a short time. Please wait a minute and try again.
      </p>
    );
  } else {
    const records = await prisma.otherLodge.findMany({
      select: publicLodgeSelect,
      orderBy: otherLodgeOrderBy(),
    });
    // Availability from the clubs' booking apps arrives in Phase D; until then
    // every lodge is "beds available unknown".
    const results = searchLodges(records.map(toPublicLodge), parsed.query);
    const guests = totalGuests(parsed.query.guests);
    body =
      results.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          No lodges match. Try fewer facilities or a smaller group.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {results.length} {results.length === 1 ? "lodge" : "lodges"} found
          </p>
          <LodgeResults results={results} guests={guests} />
        </div>
      );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2 pr-12">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Find a lodge</h1>
          <p className="text-sm text-muted-foreground">
            Search club lodges, then book on the lodge&apos;s own site. Prices are
            non-member rates in NZD, incl. GST.
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Home
        </Link>
      </header>

      {unavailable ? (
        <p role="alert" className="rounded-lg border border-warning/60 p-3 text-sm">
          That lodge has no booking page at the moment. Please choose another lodge.
        </p>
      ) : null}

      <SearchBar form={parsed.form} today={today} />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr] lg:items-start">
        <aside>
          <FacilityFilter selected={parsed.form.facilities} />
        </aside>
        <section aria-label="Search results">{body}</section>
      </div>
    </main>
  );
}
