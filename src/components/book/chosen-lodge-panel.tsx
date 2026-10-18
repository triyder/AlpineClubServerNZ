import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { seasonSpanText } from "@/lib/lodge-seasons";
import { LODGE_FACILITY_LABELS } from "@/lib/other-lodges";
import { AGE_GROUPS, formatNzd, priceNights, type SearchQuery, type SearchResult } from "@/lib/lodge-search";
import { BOOKING_REQUEST_SUBJECT, bookingRequestBody, guestWords, nightInWords } from "@/lib/bed-planner";
import { EmailClubButton } from "@/components/book/email-club-button";

/**
 * The lodge chosen in the bed planner (#25): its photo and facts, the stay
 * priced night by night, the total and "Book with the club". The prices are a
 * guide; the lodge confirms the price when the guest books on its site.
 */

const count = (n: number | null) => (n === null ? "—" : String(n));
const rateText = (rate: number | null) => (rate === null ? "—" : formatNzd(rate));

export function ChosenLodgePanel({ result, query }: { result: SearchResult; query: SearchQuery }) {
  const { lodge, estimate } = result;
  // The same pricing as the total (`estimateStay` sums `priceNights`), so the rows add up to it.
  const nights = priceNights(lodge, query);
  const headingId = `chosen-lodge-name-${lodge.id}`;
  const picture = lodge.picture;

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-6 rounded-xl border-2 border-primary bg-card p-5 lg:grid-cols-[14rem_1fr_15rem]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a library picture at a capability URL, or the static fallback */}
      <img
        src={picture?.url ?? "/no-image.svg"}
        alt={picture ? `${lodge.name}${picture.kind === "logo" ? " logo" : ""}` : ""}
        className={cn(
          "aspect-[4/3] w-full rounded-lg bg-muted",
          picture?.kind === "image" ? "object-cover" : picture ? "object-contain p-2" : "bg-[#e5e7eb] object-contain",
        )}
      />

      <div className="min-w-0 space-y-3">
        <div>
          <h2 id={headingId} className="text-2xl font-extrabold tracking-tight">
            {lodge.name}
          </h2>
          {lodge.location ? <p className="text-muted-foreground">{lodge.location}</p> : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Total beds</dt><dd className="font-medium">{count(lodge.bedCapacity)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Double beds</dt><dd className="font-medium">{count(lodge.doubleBeds)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Single beds</dt><dd className="font-medium">{count(lodge.singleBeds)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Cancellation</dt><dd className="font-medium">{lodge.cancellationPeriod ?? "—"}</dd></div>
        </dl>
        {lodge.facilities.length > 0 || lodge.amenities.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Facilities and amenities">
            {lodge.facilities.map((f) => (
              <li key={f} className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{LODGE_FACILITY_LABELS[f]}</li>
            ))}
            {lodge.amenities.map((a) => (
              <li key={a.name} title={a.description ?? undefined} className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{a.name}</li>
            ))}
          </ul>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <caption className="pb-1 text-left font-bold">Your stay, night by night</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Night and season</th>
                <th scope="col">Guests and rates</th>
                <th scope="col">Price that night</th>
              </tr>
            </thead>
            <tbody>
              {nights.map((n) => (
                <tr key={n.night} className="border-t border-border">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">
                    {nightInWords(n.night)}
                    <span className="text-muted-foreground"> · {n.season ? (n.season === "winter" ? "Winter" : "Summer") : "No season"}</span>
                  </th>
                  <td className="py-1.5 text-muted-foreground">
                    {n.parts.map((p) => `${guestWords(p, p.count)} × ${rateText(p.rate)}`).join(" + ")}
                  </td>
                  <td className="py-1.5 pl-3 text-right font-semibold tabular-nums">{n.cents === null ? "—" : formatNzd(n.cents / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground">All rates and seasons</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <caption className="sr-only">Non-member rates per person per night, NZD incl. GST</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-normal"><span className="sr-only">Season</span></th>
                  {AGE_GROUPS.map((g) => (
                    <th key={g.key} scope="col" className="py-1 pr-2 font-normal">{g.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["winter", "summer"] as const).map((season) => (
                  <tr key={season}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      <span className="capitalize">{season}</span>
                      {seasonSpanText(lodge, season) ? (
                        <span className="block text-xs text-muted-foreground">{seasonSpanText(lodge, season)}</span>
                      ) : null}
                    </th>
                    {AGE_GROUPS.map((g) => (
                      <td key={g.key} className="py-1 pr-2 tabular-nums">{rateText(lodge.rates[g[season]])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <div className="flex flex-col justify-end gap-2">
        <p className="text-xs text-muted-foreground">Non-member total, NZD incl. GST</p>
        <p className="text-4xl font-extrabold leading-none tabular-nums">
          {estimate.total !== null ? formatNzd(estimate.total) : "Ask the club"}
        </p>
        {estimate.total === null ? (
          <p className="text-sm text-muted-foreground">
            {estimate.missing === "out-of-season"
              ? "At least one night is outside this lodge's winter and summer seasons."
              : "This lodge has not given every rate or season date needed."}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">A guide only: the lodge confirms the price when you book.</p>
        )}
        {lodge.canBook ? (
          <a
            href={`/book/go/${encodeURIComponent(lodge.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Book with the club
            <ExternalLink aria-hidden className="h-4 w-4" />
            <span className="sr-only">(opens {lodge.name}&apos;s booking site in a new tab)</span>
          </a>
        ) : lodge.reachable ? (
          // No booking page, but a booking officer's email (owner, 18 Oct 2026).
          <EmailClubButton
            lodgeId={lodge.id}
            lodgeName={lodge.name}
            subject={BOOKING_REQUEST_SUBJECT}
            body={bookingRequestBody(
              [...AGE_GROUPS].reverse().map((g) => ({ ...g, count: query.guests[g.key] })),
              query.checkIn,
              query.checkOut,
            )}
          />
        ) : (
          <span className="inline-flex h-12 items-center justify-center rounded-lg bg-muted px-4 text-sm text-muted-foreground">
            No booking page yet
          </span>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {lodge.canBook || !lodge.reachable ? "Booked on the club’s own site" : "Ask the club’s booking officer"}
        </p>
      </div>
    </section>
  );
}
