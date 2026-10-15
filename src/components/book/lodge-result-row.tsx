"use client";

import { useId, type Ref } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { seasonSpanText } from "@/lib/lodge-seasons";
import { LODGE_FACILITY_LABELS } from "@/lib/other-lodges";
import {
  AGE_GROUPS,
  formatNzd,
  type SearchResult,
} from "@/lib/lodge-search";

/**
 * One lodge in the search results: picture on the left, the summary in the
 * middle, "Book now" on the right. Clicking the summary expands the row
 * downwards to the full amenity list and the non-member rates.
 *
 * The summary is an accordion header (a heading holding a button with
 * `aria-expanded`), so it works from the keyboard and to a screen reader; a
 * click anywhere else on the summary area reaches the same button.
 *
 * Controlled: whether it is open is the list's selection (`LodgeResults`).
 */

function rateText(rate: number | null): string {
  return rate === null ? "—" : formatNzd(rate);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

const count = (n: number | null) => (n === null ? "—" : String(n));

export function LodgeResultRow({
  result,
  guests,
  open,
  onToggle,
  className,
  ref,
}: {
  result: SearchResult;
  guests: number;
  open: boolean;
  onToggle: () => void;
  className?: string;
  ref?: Ref<HTMLElement>;
}) {
  const { lodge, availableBeds, estimate } = result;
  const panelId = useId();
  const picture = lodge.picture;

  return (
    <article
      ref={ref}
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        open ? "border-ring shadow-md" : "border-border",
        className,
      )}
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a library picture at a capability URL, or the static fallback */}
        <img
          src={picture?.url ?? "/no-image.svg"}
          alt={picture ? `${lodge.name}${picture.kind === "logo" ? " logo" : ""}` : ""}
          loading="lazy"
          className={cn(
            "aspect-[16/9] w-full rounded-md bg-muted sm:aspect-[4/3] sm:w-40",
            picture?.kind === "image"
              ? "object-cover"
              : picture
                ? "object-contain p-2"
                : // The fallback is shown whole, on its own grey.
                  "bg-[#e5e7eb] object-contain",
          )}
        />

        <div
          className="min-w-0 cursor-pointer space-y-2"
          onClick={(e) => {
            // The button handles its own click (and Enter/Space); anything
            // else in the summary area forwards to it.
            if (!(e.target as HTMLElement).closest("button")) onToggle();
          }}
        >
          <h3 className="text-lg font-semibold leading-tight">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
              className="flex w-full items-start justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>{lodge.name}</span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </h3>
          {lodge.location ? (
            <p className="text-sm text-muted-foreground">{lodge.location}</p>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Fact label="Cancellation" value={lodge.cancellationPeriod ?? "—"} />
            <Fact label="Double beds" value={count(lodge.doubleBeds)} />
            <Fact label="Single beds" value={count(lodge.singleBeds)} />
            <Fact label="Total beds" value={count(lodge.bedCapacity)} />
          </dl>
          <p className="text-sm">
            {availableBeds !== null ? (
              <span className="font-medium text-success">
                {availableBeds} beds available for your dates
              </span>
            ) : (
              <span className="text-muted-foreground">
                {lodge.bedCapacity !== null ? `Up to ${lodge.bedCapacity} beds · ` : ""}
                beds available unknown
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          {lodge.canBook ? (
            <>
              <a
                href={`/book/go/${encodeURIComponent(lodge.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Book now
                <ExternalLink aria-hidden className="h-4 w-4" />
                <span className="sr-only">
                  (opens {lodge.name}&apos;s booking site in a new tab)
                </span>
              </a>
              <span className="text-center text-xs text-muted-foreground sm:text-right">
                Booked on the lodge&apos;s own site
              </span>
            </>
          ) : (
            <span className="inline-flex h-9 items-center justify-center rounded-md bg-muted px-4 text-sm text-muted-foreground">
              No booking page yet
            </span>
          )}
        </div>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="grid gap-6 border-t border-border bg-muted/40 p-4 md:grid-cols-2"
      >
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Amenities</h4>
          {lodge.facilities.length === 0 && lodge.amenities.length === 0 ? (
            <p className="text-sm text-muted-foreground">None listed.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {lodge.facilities.map((f) => (
                <li key={f}>{LODGE_FACILITY_LABELS[f]}</li>
              ))}
              {lodge.amenities.map((a) => (
                <li key={a.name}>
                  {a.name}
                  {a.description ? (
                    <span className="text-muted-foreground"> — {a.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold">
            Non-member rates per person per night (NZD, incl. GST)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-normal">
                    <span className="sr-only">Season</span>
                  </th>
                  {AGE_GROUPS.map((g) => (
                    <th key={g.key} scope="col" className="py-1 pr-2 font-normal">
                      {g.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["winter", "summer"] as const).map((season) => (
                  <tr key={season}>
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      <span className="capitalize">{season}</span>
                      {seasonSpanText(lodge, season) ? (
                        <span className="block text-xs text-muted-foreground">
                          {seasonSpanText(lodge, season)}
                        </span>
                      ) : null}
                    </th>
                    {AGE_GROUPS.map((g) => (
                      <td key={g.key} className="py-1 pr-2 tabular-nums">
                        {rateText(lodge.rates[g[season]])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            {estimate.total !== null ? (
              <>
                Estimated total for {guests} {guests === 1 ? "guest" : "guests"},{" "}
                {estimate.nights} {estimate.nights === 1 ? "night" : "nights"}:{" "}
                <span className="font-semibold">{formatNzd(estimate.total)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {estimate.missing === "out-of-season"
                  ? "Price not available for these dates: at least one night is outside this lodge's winter and summer seasons."
                  : "No estimate: this lodge has not given every rate or season date needed."}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            A guide only. The lodge confirms the price when you book on its site.
          </p>
        </section>
      </div>
    </article>
  );
}
