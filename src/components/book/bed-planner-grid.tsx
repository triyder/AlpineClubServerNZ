import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { freeBedsWords, nightLabel, nightLevel, type NightLevel } from "@/lib/bed-planner";

/**
 * The bed planner's grid (#25): lodges down the side, nights across, the free
 * beds in each cell. The stay's nights are highlighted.
 *
 * Colour is never the only signal (WCAG 1.4.1): "room" has a thin border,
 * "only a few left" a thick border and bold figure, "not enough" a struck-
 * through figure, and an unknown night a dashed outline with "?" or "–". Each
 * cell's meaning is also in its text for screen readers, and the legend shows
 * every kind. Every border is the level's full colour, so the cell stands out
 * from the card (1.4.11).
 */

export const LEVEL_STYLES: Record<NightLevel, string> = {
  room: "border border-success bg-success/25 text-foreground",
  few: "border-2 border-warning bg-warning/40 font-extrabold text-foreground",
  short: "border border-muted-foreground bg-muted-foreground/15 text-foreground line-through decoration-2",
  unknown: "border border-dashed border-muted-foreground text-foreground",
};

export const LEVEL_WORDS: Record<NightLevel, string> = {
  room: "Room for your group",
  few: "Only a few beds left",
  short: "Not enough beds",
  unknown: "Club not answering",
};

/** For a club that answered for the stay, but not night by night (an older booking app). */
export const NOT_NIGHTLY_WORDS = "Not known night by night";

export interface PlannerRow {
  id: string;
  name: string;
  location: string | null;
  /** Free beds by night, or null when the club did not say night by night. */
  nights: Record<string, number> | null;
  /** The fewest free beds on any night of the stay, or null when unknown. */
  stayFreeBeds: number | null;
  /** "$252", or why there is no price. */
  stayText: string;
  /** The search with this lodge chosen (the link without JavaScript). */
  href: string;
}

export function BedCell({
  freeBeds,
  guests,
  notNightly = false,
}: {
  freeBeds: number | undefined;
  guests: number;
  /** The club answered for the stay only: "–" rather than "?". */
  notNightly?: boolean;
}) {
  const level = nightLevel(freeBeds, guests);
  const text = freeBeds === undefined ? (notNightly ? "–" : "?") : freeBeds === 0 ? "Full" : String(freeBeds);
  const words =
    freeBeds === undefined
      ? notNightly
        ? NOT_NIGHTLY_WORDS
        : LEVEL_WORDS.unknown
      : `${freeBedsWords(freeBeds)}, ${LEVEL_WORDS[level].toLowerCase()}`;
  return (
    <span
      className={cn(
        "inline-flex h-9 min-w-11 items-center justify-center rounded-md px-1 text-sm font-semibold tabular-nums",
        LEVEL_STYLES[level],
      )}
    >
      <span aria-hidden>{text}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

const LEGEND: Array<{ level: NightLevel; sample: string; words: string }> = [
  { level: "room", sample: "12", words: LEVEL_WORDS.room },
  { level: "few", sample: "5", words: LEVEL_WORDS.few },
  { level: "short", sample: "2", words: LEVEL_WORDS.short },
  { level: "unknown", sample: "?", words: LEVEL_WORDS.unknown },
];

export function PlannerLegend({ showNotNightly = false }: { showNotNightly?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {LEGEND.map(({ level, sample, words }) => (
        <li key={level} className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("inline-flex h-6 min-w-7 items-center justify-center rounded px-1 text-xs font-semibold", LEVEL_STYLES[level])}
          >
            {sample}
          </span>
          {words}
        </li>
      ))}
      {showNotNightly ? (
        <li className="flex items-center gap-2">
          <span aria-hidden className={cn("inline-flex h-6 min-w-7 items-center justify-center rounded px-1 text-xs font-semibold", LEVEL_STYLES.unknown)}>
            –
          </span>
          {NOT_NIGHTLY_WORDS}
        </li>
      ) : null}
    </ul>
  );
}

export function BedPlannerGrid({
  nights,
  stayNights,
  rows,
  guests,
  chosenId,
  caption,
  onChoose,
}: {
  nights: string[];
  stayNights: ReadonlySet<string>;
  rows: PlannerRow[];
  guests: number;
  chosenId: string | null;
  caption: string;
  /** Choose a lodge in place; without it (or without JavaScript) the link navigates. */
  onChoose?: (row: PlannerRow, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <caption className="border-b border-border bg-muted/40 px-4 py-3 text-left text-base font-bold">
            {caption}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-2 text-left text-xs font-semibold text-muted-foreground">
                Lodge
              </th>
              {nights.map((night) => {
                const { weekday, day } = nightLabel(night);
                const inStay = stayNights.has(night);
                return (
                  <th
                    key={night}
                    scope="col"
                    className={cn(
                      "px-1 py-2 text-center text-xs font-semibold",
                      inStay ? "bg-primary/10 text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {weekday}
                    <span className="block text-sm">{day}</span>
                    {inStay ? <span className="sr-only"> (your stay)</span> : null}
                  </th>
                );
              })}
              <th scope="col" className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground">
                Your stay
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const chosen = row.id === chosenId;
              return (
                <tr key={row.id} className="border-t border-border">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 bg-card px-4 py-3 text-left font-semibold",
                      chosen && "shadow-[inset_4px_0_0_var(--primary)]",
                    )}
                  >
                    <a
                      href={row.href}
                      onClick={onChoose ? (event) => onChoose(row, event) : undefined}
                      aria-current={chosen ? "true" : undefined}
                      className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row.name}
                    </a>
                    {chosen ? <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-primary-foreground">Chosen</span> : null}
                    {row.location ? (
                      <span className="block text-xs font-normal text-muted-foreground">{row.location}</span>
                    ) : null}
                  </th>
                  {nights.map((night) => (
                    <td key={night} className={cn("px-1 py-2 text-center", stayNights.has(night) && "bg-primary/5")}>
                      <BedCell
                        freeBeds={row.nights?.[night]}
                        guests={guests}
                        notNightly={row.nights === null && row.stayFreeBeds !== null}
                      />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold">
                    {row.stayText}
                    {row.nights === null && row.stayFreeBeds !== null ? (
                      <span className="block text-xs font-normal text-muted-foreground">{freeBedsWords(row.stayFreeBeds)}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-4 py-3">
        <PlannerLegend showNotNightly={rows.some((r) => r.nights === null && r.stayFreeBeds !== null)} />
      </div>
    </div>
  );
}
