"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { eachNight } from "@/lib/lodge-search";
import { nightLabel, nightsInWords, type HomeNightsResponse } from "@/lib/bed-planner";
import { BedCell, PlannerLegend } from "@/components/book/bed-planner-grid";

/**
 * The home page's "this weekend" grid (#25): free beds at every public lodge
 * for this weekend's nights, fetched from `/book/nights` once the page is in
 * the browser (so a crawler that does not run JavaScript never makes the
 * server ask every club). Coloured for the bed planner's starting party, two
 * adults, which is what each lodge's link opens with.
 */

/** The planner's default party (`DEFAULT_GUESTS` in `lodge-search`). */
const HOME_PARTY = 2;

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: HomeNightsResponse }
  | { kind: "failed" };

export function WeekendGrid({ checkIn, checkOut }: { checkIn: string; checkOut: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const nights = eachNight(checkIn, checkOut);

  useEffect(() => {
    let live = true;
    fetch(`/book/nights?from=${checkIn}&to=${checkOut}`, { cache: "no-store" })
      .then(async (res) => {
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (live) setState(body ? { kind: "ready", data: body as HomeNightsResponse } : { kind: "failed" });
      })
      .catch(() => live && setState({ kind: "failed" }));
    return () => {
      live = false;
    };
  }, [checkIn, checkOut]);

  const book = (lodgeId?: string) =>
    `/book?checkIn=${checkIn}&checkOut=${checkOut}${lodgeId ? `&lodge=${encodeURIComponent(lodgeId)}#chosen-lodge` : ""}`;

  const status =
    state.kind === "loading"
      ? "Asking the clubs…"
      : state.kind === "failed"
        ? "Free beds could not be loaded just now."
        : state.data.lodges.length === 0
          ? "No lodges are listed yet."
          : `Free beds for ${state.data.lodges.length} ${state.data.lodges.length === 1 ? "lodge" : "lodges"}.`;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <h2 className="text-base font-bold">Free beds, {nightsInWords(nights)}</h2>
        <span className="text-xs text-muted-foreground">Coloured for 2 adults</span>
      </div>
      <p role="status" className={state.kind === "ready" && state.data.lodges.length > 0 ? "sr-only" : "px-4 py-8 text-center text-sm text-muted-foreground"}>
        {status}
        {state.kind === "failed" ? (
          <>
            {" "}
            <Link href={book()} className="underline">Open the bed planner</Link>
          </>
        ) : null}
      </p>
      {state.kind === "ready" && state.data.lodges.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Free beds at each lodge, {nightsInWords(nights)}</caption>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-left font-semibold">Lodge</th>
                {nights.map((n) => {
                  const { weekday, day } = nightLabel(n);
                  return (
                    <th key={n} scope="col" className="px-2 py-2 text-center font-semibold">
                      {weekday} <span className="text-foreground">{day}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {state.data.lodges.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-semibold">
                    <Link href={book(l.id)} className="underline-offset-4 hover:underline">{l.name}</Link>
                    {l.location ? <span className="block text-xs font-normal text-muted-foreground">{l.location}</span> : null}
                  </th>
                  {nights.map((n) => (
                    <td key={n} className="px-2 py-2 text-center">
                      <BedCell freeBeds={l.nights[n]} guests={HOME_PARTY} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="border-t border-border px-4 py-3">
        <PlannerLegend />
      </div>
    </div>
  );
}
