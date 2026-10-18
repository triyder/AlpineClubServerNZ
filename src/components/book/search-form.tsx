import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LeaveFollowsArrive } from "@/components/book/leave-follows-arrive";
import {
  LODGE_BOOLEAN_FIELDS,
  LODGE_FACILITY_LABELS,
} from "@/lib/other-lodges";
import {
  GUEST_FIELDS,
  GUESTS_PER_GROUP_MAX,
  guestFieldLabel,
  type SearchFormValues,
} from "@/lib/lodge-search";

/**
 * The bed planner's search (#25): arrive, leave, the guests by age group and
 * the amenities the lodge must have, in a drop-down list of ticks. A plain GET form,
 * so the search lives in the URL and works without JavaScript.
 */
export function SearchBar({ form, today }: { form: SearchFormValues; today: string }) {
  const ticked = form.facilities.length;
  return (
    <form
      method="get"
      action="/book"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="checkIn">Arrive</Label>
        <Input id="checkIn" name="checkIn" type="date" min={today} required defaultValue={form.checkIn} className="h-11" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="checkOut">Leave</Label>
        <Input id="checkOut" name="checkOut" type="date" min={today} required defaultValue={form.checkOut} className="h-11" />
      </div>
      <fieldset className="min-w-0 space-y-1.5">
        <legend className="text-sm font-medium leading-none">Guests</legend>
        <div className="grid grid-cols-4 gap-2 pt-1.5">
          {GUEST_FIELDS.map((g) => (
            <div key={g.key} className="w-16 space-y-1">
              <label htmlFor={`guests-${g.key}`} className="block text-xs text-muted-foreground">
                {guestFieldLabel(g)}
              </label>
              <Input
                id={`guests-${g.key}`}
                name={g.key}
                type="number"
                inputMode="numeric"
                min={0}
                max={GUESTS_PER_GROUP_MAX}
                defaultValue={form.guests[g.key]}
                className="h-11"
              />
            </div>
          ))}
        </div>
      </fieldset>
      <details className="group relative">
        <summary className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          Amenities{ticked > 0 ? ` (${ticked})` : ""}
          <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <fieldset className="absolute z-20 mt-2 grid w-72 max-w-[calc(100vw-2rem)] gap-2 rounded-lg border border-border bg-card p-4 shadow-lg">
          <legend className="sr-only">Amenities the lodge must have</legend>
          <p className="text-xs text-muted-foreground">Show only lodges that have every ticked facility.</p>
          {LODGE_BOOLEAN_FIELDS.map((key) => (
            <label key={key} className="flex min-h-7 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="facility"
                value={key}
                defaultChecked={form.facilities.includes(key)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              {LODGE_FACILITY_LABELS[key]}
            </label>
          ))}
        </fieldset>
      </details>
      <LeaveFollowsArrive arriveId="checkIn" leaveId="checkOut" />
      <Button type="submit" className="h-11 px-6">
        <Search className="h-4 w-4" aria-hidden />
        Search
      </Button>
    </form>
  );
}
