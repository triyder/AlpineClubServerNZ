"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ClubLodgeOption {
  id: string;
  name: string;
  /** The club that owns it, or null when it is central. */
  ownerClubId: string | null;
  ownerClubName: string | null;
}

/** Show a filter box once the list is long enough to need one. */
const FILTER_THRESHOLD = 8;

/**
 * Choose which lodges a club owns.
 *
 * The chosen lodges' names are shown side by side ABOVE the dropdown, which is a
 * group of checkboxes (plain checkboxes, not a listbox: the roles would contradict
 * the native controls inside). A lodge owned by another club is listed but
 * disabled, with that club's name: taking one would silently strip it from the
 * other club, so it has to be unticked there first (the server refuses it too).
 *
 * The choice is staged until Save, and the whole list is sent, because the
 * server treats it as the club's complete set. A successful save refreshes the
 * page, which re-keys and remounts this component on the saved list: the updated
 * chips ARE the confirmation, so there is no separate "Saved" message.
 */
export function ClubLodgesSelect({
  clubId,
  options,
  initialSelectedIds,
  canManage,
}: {
  clubId: string;
  options: ClubLodgeOption[];
  initialSelectedIds: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<string[]>(initialSelectedIds);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on a click outside, or on Escape — which also hands focus back to the
  // button that opened it, so a keyboard user is not left on a removed control.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = new Map(options.map((o) => [o.id, o]));
  const chosen = selected
    .map((id) => byId.get(id))
    .filter((o): o is ClubLodgeOption => Boolean(o))
    .sort((a, b) => a.name.localeCompare(b.name));

  const dirty =
    selected.length !== initialSelectedIds.length ||
    selected.some((id) => !initialSelectedIds.includes(id));

  const shown = options.filter((o) =>
    o.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clubs/${clubId}/lodges`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lodgeIds: selected }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not save the lodges.");
      }
      setOpen(false);
      triggerRef.current?.focus();
      // Reload the server data; the parent re-keys this component on the new
      // saved list, which remounts it with the chips as the confirmation.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the lodges.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <p className="text-sm font-medium">Lodges</p>

      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected lodges">
          {chosen.map((lodge) => (
            <li key={lodge.id}>
              <Badge variant="secondary" className="gap-1">
                {lodge.name}
                {canManage ? (
                  <button
                    type="button"
                    aria-label={`Remove ${lodge.name}`}
                    disabled={saving}
                    onClick={() => toggle(lodge.id)}
                    className="rounded-sm hover:text-destructive disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No lodges assigned.</p>
      )}

      {canManage ? (
        <>
          <div className="relative">
            <Button
              ref={triggerRef}
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              aria-controls={listId}
              disabled={saving}
              onClick={() => setOpen((v) => !v)}
              className="w-full justify-between sm:w-72"
            >
              {options.length === 0 ? "No lodges to choose from" : "Select lodges"}
              <ChevronDown className="h-4 w-4" />
            </Button>

            {open && options.length > 0 ? (
              <div
                id={listId}
                className="absolute z-20 mt-1 w-full space-y-2 rounded-md border border-border bg-background p-2 shadow-md sm:w-72"
              >
                {options.length > FILTER_THRESHOLD ? (
                  <Input
                    aria-label="Filter lodges"
                    placeholder="Filter lodges"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                ) : null}
                <fieldset>
                  <legend className="sr-only">Lodges this club owns</legend>
                  <ul className="max-h-56 overflow-y-auto">
                    {shown.length === 0 ? (
                      <li className="px-2 py-1 text-xs text-muted-foreground">
                        No lodges match.
                      </li>
                    ) : null}
                    {shown.map((lodge) => {
                      const takenByOther =
                        lodge.ownerClubId !== null && lodge.ownerClubId !== clubId;
                      const checked = selected.includes(lodge.id);
                      return (
                        <li key={lodge.id}>
                          <label
                            className={cn(
                              "flex items-center gap-2 rounded px-2 py-1 text-sm",
                              takenByOther
                                ? "cursor-not-allowed text-muted-foreground"
                                : "cursor-pointer hover:bg-accent",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-[var(--primary)]"
                              checked={checked}
                              disabled={takenByOther || saving}
                              onChange={() => toggle(lodge.id)}
                            />
                            <span>
                              {lodge.name}
                              {takenByOther && lodge.ownerClubName ? (
                                <span className="block text-xs">
                                  Assigned to {lodge.ownerClubName}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save lodges"}
            </Button>
            {dirty && !saving ? (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            ) : null}
          </div>
        </>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
