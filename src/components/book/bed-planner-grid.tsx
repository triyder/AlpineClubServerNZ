import { Fragment, type MouseEvent, type ReactNode, type Ref } from "react";
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
 *
 * The open lodge's panel (`expanded`) is a full-width row directly under its
 * lodge, held to the visible width of the table's scroll box (`panelWidth`)
 * and pinned to its left edge, so on a phone it never scrolls sideways with
 * the nights.
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
  /** "$252", or "Ask the club". */
  stayText: string;
  /** Small print under an unknown price: "32 beds in lodge". */
  stayNote?: string;
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

/**
 * The key, in the Option D design's style (owner, 18 Oct 2026): a small
 * square in each level's colour and border, then its words; the unknown
 * kinds show their mark ("?" or "–") in place of the square.
 */
export function PlannerLegend({ showNotNightly = false }: { showNotNightly?: boolean }) {
  const square = "inline-block h-3.5 w-3.5 shrink-0 rounded-sm";
  return (
    <ul aria-label="Key" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {(["room", "few", "short"] as const).map((level) => (
        <li key={level} className="flex items-center gap-1.5">
          <span aria-hidden className={cn(square, LEVEL_STYLES[level], "border")} />
          {LEVEL_WORDS[level]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="font-bold text-foreground">?</span>
        {LEVEL_WORDS.unknown}
      </li>
      {showNotNightly ? (
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="font-bold text-foreground">–</span>
          {NOT_NIGHTLY_WORDS}
        </li>
      ) : null}
    </ul>
  );
}

const ARROW =
  "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-lg font-semibold";

/** ‹ or ›: a link to the grid a week earlier or later, or a dimmed mark where it cannot go. */
function WeekArrow({ href, label, mark }: { href: string | null; label: string; mark: string }) {
  return href ? (
    <a href={href} aria-label={label} className={cn(ARROW, "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      <span aria-hidden>{mark}</span>
    </a>
  ) : (
    <span aria-hidden className={cn(ARROW, "cursor-not-allowed opacity-40")}>
      {mark}
    </span>
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
  expanded,
  panelWidth,
  scrollRef,
  panelRef,
  previousHref,
  nextHref,
}: {
  nights: string[];
  stayNights: ReadonlySet<string>;
  rows: PlannerRow[];
  guests: number;
  /** The open lodge, if any. */
  chosenId: string | null;
  caption: string;
  /** Open or close a lodge in place; without it (or without JavaScript) the link navigates. */
  onChoose?: (row: PlannerRow, event: MouseEvent<HTMLAnchorElement>) => void;
  /** The open lodge's panel, shown in a row under it. */
  expanded?: ReactNode;
  /** The scroll box's visible width in px, so the panel fits it; unset before it is measured. */
  panelWidth?: number;
  scrollRef?: Ref<HTMLDivElement>;
  panelRef?: Ref<HTMLDivElement>;
  /** The grid a week earlier and later (‹ ›); null where it cannot go. */
  previousHref?: string | null;
  nextHref?: string | null;
}) {
  const columns = nights.length + 2;
  return (
    <div id="planner" className="scroll-mt-4 overflow-hidden rounded-xl border border-border bg-card">
      {/* The title, the key and the arrows, above the scroll box so they stay put on a phone. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-muted/40 px-4 py-3">
        <p aria-hidden className="text-base font-bold">{caption}</p>
        <PlannerLegend showNotNightly={rows.some((r) => r.nights === null && r.stayFreeBeds !== null)} />
        {previousHref !== undefined || nextHref !== undefined ? (
          <nav aria-label="Move the grid" className="ml-auto flex gap-2">
            <WeekArrow href={previousHref ?? null} label="A week earlier" mark="‹" />
            <WeekArrow href={nextHref ?? null} label="A week later" mark="›" />
          </nav>
        ) : null}
      </div>
      <div ref={scrollRef} className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
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
              const panelId = `lodge-panel-${row.id}`;
              return (
                <Fragment key={row.id}>
                <tr className="border-t border-border">
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
                      aria-expanded={chosen}
                      aria-controls={chosen ? panelId : undefined}
                      data-lodge-link
                      className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {row.name}
                    </a>
                    {chosen ? <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-primary-foreground">Open</span> : null}
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
                    {row.stayNote ? (
                      <span className="block text-xs font-normal text-muted-foreground">{row.stayNote}</span>
                    ) : null}
                  </td>
                </tr>
                {chosen && expanded ? (
                  <tr id="chosen-lodge" className="scroll-mt-4">
                    <td colSpan={columns} className="p-0">
                      <div
                        ref={panelRef}
                        id={panelId}
                        tabIndex={-1}
                        style={panelWidth ? { width: panelWidth } : undefined}
                        className="sticky left-0 p-3 focus-visible:outline-none"
                      >
                        {expanded}
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
