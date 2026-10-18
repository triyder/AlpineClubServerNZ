"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BedPlannerGrid, type PlannerRow } from "@/components/book/bed-planner-grid";

/**
 * The bed planner's grid, with each lodge opening IN PLACE (#25, owner,
 * 17 Oct 2026): choosing a lodge expands its panel in a row directly under it;
 * pressing anywhere outside that panel, pressing Escape, or choosing the lodge
 * again closes it, and choosing another lodge opens that one instead.
 *
 * Every lodge's panel arrives with the page, so opening one asks nothing of
 * the server: no new search, no second round of questions to the clubs. The
 * address follows the choice (`history.replaceState`), and an opened panel is
 * scrolled into view and focused. Without JavaScript each lodge name is a link
 * to the same search with that lodge open.
 */

/** The search's address with no lodge open. */
function withoutLodge(href: string): string {
  const url = new URL(href, window.location.origin);
  url.searchParams.delete("lodge");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

/** An address without its `#chosen-lodge` (the no-JavaScript scroll target). */
function withoutHash(href: string): string {
  const at = href.indexOf("#");
  return at === -1 ? href : href.slice(0, at);
}

export function PlannerView({
  nights,
  stayNights,
  rows,
  guests,
  caption,
  panels,
  initialId,
  previousHref,
  nextHref,
  initialShowAll,
  showAllHref,
}: {
  nights: string[];
  stayNights: string[];
  rows: PlannerRow[];
  guests: number;
  caption: string;
  panels: Array<{ id: string; panel: ReactNode }>;
  initialId: string | null;
  previousHref: string | null;
  nextHref: string | null;
  initialShowAll: boolean;
  showAllHref: string;
}) {
  const [showAll, setShowAll] = useState(initialShowAll);
  const [openId, setOpenId] = useState(initialId);
  const [opened, setOpened] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The panel is as wide as the table's visible scroll box, never the table.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const measure = () => setPanelWidth(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // A panel the guest just opened is brought into view and focused.
  useEffect(() => {
    if (!opened || !openId) return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panelRef.current?.focus({ preventScroll: true });
  }, [openId, opened]);

  const close = useCallback(() => {
    setOpenId(null);
    window.history.replaceState(null, "", withoutLodge(window.location.href));
  }, []);

  // Close on a press outside the open panel, or Escape. A press on another
  // lodge's name is left to that link, which opens it instead. On CLICK, not
  // pointer-down: closing on press moves the rows below up, and the release
  // would land on something else.
  useEffect(() => {
    if (!openId) return;
    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (panelRef.current?.contains(target)) return;
      if (target?.closest("[data-lodge-link], [data-lodge-row]")) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const link = document.querySelector<HTMLElement>(`[aria-controls="lodge-panel-${openId}"]`);
      close();
      link?.focus();
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openId, close]);

  return (
    <BedPlannerGrid
      nights={nights}
      stayNights={new Set(stayNights)}
      rows={rows}
      guests={guests}
      chosenId={openId}
      caption={caption}
      expanded={panels.find((p) => p.id === openId)?.panel}
      panelWidth={panelWidth}
      scrollRef={scrollRef}
      panelRef={panelRef}
      previousHref={previousHref}
      nextHref={nextHref}
      showAll={showAll}
      showAllHref={showAllHref}
      onShowAll={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        setShowAll(true);
        window.history.replaceState(null, "", showAllHref.replace(/#.*$/, ""));
      }}
      onChoose={(row, event) => {
        // A modified click (new tab or window) keeps the link's own behaviour;
        // on the rest of the row it does nothing.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        if (row.id === openId) {
          close();
          return;
        }
        setOpenId(row.id);
        setOpened(true);
        window.history.replaceState(null, "", withoutHash(row.href));
      }}
    />
  );
}
