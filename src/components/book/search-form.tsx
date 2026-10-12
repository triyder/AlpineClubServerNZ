"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LODGE_BOOLEAN_FIELDS,
  LODGE_FACILITY_LABELS,
} from "@/lib/other-lodges";
import {
  AGE_GROUPS,
  GUESTS_PER_GROUP_MAX,
  type SearchFormValues,
} from "@/lib/lodge-search";

/**
 * The search bar and the facility filter. A plain GET form, so the search
 * lives in the URL and works without JavaScript; ticking a facility submits it
 * straight away. The filter sits in the sidebar, outside the <form> element,
 * and joins it through the `form` attribute.
 */

export const SEARCH_FORM_ID = "book-search";

function submitSearch() {
  const form = document.getElementById(SEARCH_FORM_ID);
  if (form instanceof HTMLFormElement) form.requestSubmit();
}

export function SearchBar({ form, today }: { form: SearchFormValues; today: string }) {
  return (
    <form
      id={SEARCH_FORM_ID}
      method="get"
      action="/book"
      className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end"
    >
      <div className="space-y-1.5">
        <Label htmlFor="checkIn">Check-in</Label>
        <Input
          id="checkIn"
          name="checkIn"
          type="date"
          min={today}
          required
          defaultValue={form.checkIn}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="checkOut">Check-out</Label>
        <Input
          id="checkOut"
          name="checkOut"
          type="date"
          min={today}
          required
          defaultValue={form.checkOut}
        />
      </div>
      <fieldset className="space-y-1.5 sm:col-span-2 lg:col-span-1">
        <legend className="text-sm font-medium leading-none">Guests (age)</legend>
        <div className="grid grid-cols-4 gap-2 pt-1.5">
          {AGE_GROUPS.map((g) => (
            <div key={g.key} className="space-y-1">
              <label
                htmlFor={`guests-${g.key}`}
                className="block text-xs text-muted-foreground"
              >
                {g.label}
              </label>
              <Input
                id={`guests-${g.key}`}
                name={g.key}
                type="number"
                inputMode="numeric"
                min={0}
                max={GUESTS_PER_GROUP_MAX}
                defaultValue={form.guests[g.key]}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <Button type="submit" className="sm:col-span-2 lg:col-span-1">
        <Search className="h-4 w-4" aria-hidden />
        Search
      </Button>
    </form>
  );
}

export function FacilityFilter({ selected }: { selected: SearchFormValues["facilities"] }) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-border bg-card p-4">
      <legend className="sr-only">Facilities</legend>
      <p aria-hidden className="text-sm font-medium">
        Facilities
      </p>
      <p className="text-xs text-muted-foreground">
        Show only lodges that have every ticked facility.
      </p>
      <div className="grid gap-2 pt-1">
        {LODGE_BOOLEAN_FIELDS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              form={SEARCH_FORM_ID}
              name="facility"
              value={key}
              defaultChecked={selected.includes(key)}
              onChange={submitSearch}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {LODGE_FACILITY_LABELS[key]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
