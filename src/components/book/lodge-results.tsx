"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/lib/lodge-search";
import { LodgeResultRow } from "@/components/book/lodge-result-row";

/**
 * The result list, and which lodge is SELECTED. Selecting a lodge expands it
 * and fades the others; pressing anywhere outside the selected lodge, or
 * Escape, clears the selection and every lodge is shown normally again.
 * Pressing a faded lodge selects that one instead.
 */
export function LodgeResults({
  results,
  guests,
}: {
  results: SearchResult[];
  guests: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (selectedId === null) return;
    // On CLICK, not pointer-down: clearing on press collapses the open row,
    // the rows below move up, and the release lands on something else. In the
    // CAPTURE phase, so it runs before the row's own handler: a click on
    // another lodge clears this selection and that row then selects itself.
    function onClick(e: MouseEvent) {
      if (!selectedRef.current?.contains(e.target as Node)) setSelectedId(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedId]);

  return (
    <div className="space-y-3">
      {results.map((r) => {
        const selected = r.lodge.id === selectedId;
        return (
          <LodgeResultRow
            key={r.lodge.id}
            ref={selected ? selectedRef : undefined}
            result={r}
            guests={guests}
            open={selected}
            onToggle={() => setSelectedId(selected ? null : r.lodge.id)}
            className={cn(
              "transition-opacity duration-200",
              selectedId !== null && !selected && "opacity-50 hover:opacity-75",
            )}
          />
        );
      })}
    </div>
  );
}
