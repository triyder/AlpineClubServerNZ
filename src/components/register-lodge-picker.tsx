"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import type { ClubLodgeOption } from "@/components/club-lodges-select";

/**
 * The lodge picker on `/register` (#40): which lodge(s) the registering club
 * is. Plain checkboxes inside the registration form, posted as `lodgeIds`.
 *
 * The one rule it shares with the administrator's chooser on Connections: a
 * lodge another club already owns is VISIBLE but not selectable, with that
 * club's name, so the registrant sees their lodge is spoken for rather than
 * wondering why it is missing. Choosing is optional — a lodge not in the
 * registry yet is said in the notes and added by the administrator.
 */
export function RegisterLodgePicker({ options }: { options: ClubLodgeOption[] }) {
  const listId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  const shown = options.filter((o) =>
    o.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No lodges are listed yet. Say which lodge you are in the notes and the
        administrator will add it when approving.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2" aria-describedby={`${listId}-hint`}>
      <legend className="text-sm font-medium">Which lodge are you? (optional)</legend>
      <p id={`${listId}-hint`} className="text-xs text-muted-foreground">
        Tick the lodge or lodges your club owns. A greyed-out lodge is already
        connected by another club. Not listed? Say so in the notes and the
        administrator will add it when approving.
      </p>
      {options.length > 8 ? (
        <input
          aria-label="Filter lodges"
          placeholder="Filter lodges"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      ) : null}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
        {shown.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">No lodges match.</li>
        ) : null}
        {shown.map((lodge) => {
          const owned = lodge.ownerClubId !== null;
          const checked = selected.includes(lodge.id);
          return (
            <li key={lodge.id}>
              <label
                className={cn(
                  "flex items-center gap-2 rounded px-2 py-1 text-sm",
                  owned ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-muted",
                )}
              >
                <input
                  type="checkbox"
                  name="lodgeIds"
                  value={lodge.id}
                  checked={checked}
                  disabled={owned}
                  onChange={() => toggle(lodge.id)}
                />
                <span>{lodge.name}</span>
                {owned ? (
                  <span className="text-xs">
                    — connected by {lodge.ownerClubName ?? "another club"}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
