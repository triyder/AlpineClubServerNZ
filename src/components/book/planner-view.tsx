"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BedPlannerGrid, type PlannerRow } from "@/components/book/bed-planner-grid";

/**
 * The bed planner's grid and the chosen lodge's panel (#25). Every lodge's
 * panel arrives with the page, so choosing a lodge switches panels in place:
 * no new search, no second round of questions to the clubs, and the free beds
 * cannot change between clicks. The address follows the choice
 * (`history.replaceState`), and the panel is scrolled into view and focused so
 * keyboard and screen-reader users land on it. Without JavaScript each lodge
 * name is an ordinary link to the same search with that lodge chosen.
 */
export function PlannerView({
  nights,
  stayNights,
  rows,
  guests,
  caption,
  panels,
  initialId,
}: {
  nights: string[];
  stayNights: string[];
  rows: PlannerRow[];
  guests: number;
  caption: string;
  panels: Array<{ id: string; panel: ReactNode }>;
  initialId: string | null;
}) {
  const [chosenId, setChosenId] = useState(initialId);
  const [moved, setMoved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moved) return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    panelRef.current?.focus({ preventScroll: true });
  }, [chosenId, moved]);

  const panel = panels.find((p) => p.id === chosenId)?.panel ?? null;
  return (
    <>
      <BedPlannerGrid
        nights={nights}
        stayNights={new Set(stayNights)}
        rows={rows}
        guests={guests}
        chosenId={chosenId}
        caption={caption}
        onChoose={(row, event) => {
          // A modified click (new tab or window) keeps the link's own behaviour.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          setChosenId(row.id);
          setMoved(true);
          window.history.replaceState(null, "", row.href);
        }}
      />
      {panel ? (
        <div
          ref={panelRef}
          id="chosen-lodge"
          tabIndex={-1}
          aria-live="polite"
          className="scroll-mt-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {panel}
        </div>
      ) : null}
    </>
  );
}
