"use client";

import { useCallback, useEffect, useState } from "react";
import { Building, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ImagePicker } from "@/components/image-picker";
import type { LodgeImageRef } from "@/lib/image-library";
import {
  AMENITIES_PER_LODGE_MAX,
  AMENITY_DESCRIPTION_MAX,
  AMENITY_NAME_MAX,
  LODGE_BOOLEAN_FIELDS,
  LODGE_FACILITY_LABELS,
  LODGE_NAME_MAX,
  LODGE_RATE_FIELDS,
  LODGE_RATE_MAX,
  SIMILAR_LODGE_NAME_CODE,
  type LodgeBooleanField,
  type LodgeRateField,
  type SerializedOtherLodge,
} from "@/lib/other-lodges";

const BOOLEAN_FIELDS = LODGE_BOOLEAN_FIELDS.map((key) => ({
  key,
  label: LODGE_FACILITY_LABELS[key],
}));

// The rate grid: a row per season, a column per guideline age group. Typed
// over the field list, so a rate field missing from the grid is a type error.
const RATE_AGE_GROUPS = ["Under 5", "5–11", "12–17", "18+"] as const;
const RATE_GRID: ReadonlyArray<{
  season: string;
  fields: readonly [LodgeRateField, LodgeRateField, LodgeRateField, LodgeRateField];
}> = [
  {
    season: "Winter",
    fields: ["winterRateUnder5", "winterRate5To11", "winterRate12To17", "winterRateAdult"],
  },
  {
    season: "Summer",
    fields: ["summerRateUnder5", "summerRate5To11", "summerRate12To17", "summerRateAdult"],
  },
];

/** Blank, or dollars with at most two decimal places. */
const RATE_PATTERN = /^\d+(\.\d{1,2})?$/;

type AmenityRow = { name: string; description: string };

type FormState = {
  name: string;
  location: string;
  bookingOfficerName: string;
  bookingOfficerEmail: string;
  bookingOfficerPhone: string;
  bedCapacity: string;
  siteUrl: string;
  doubleBeds: string;
  singleBeds: string;
  minutesWalkToLodge: string;
  roomType: "ROOM" | "DORMITORY" | "";
  cancellationPeriod: string;
  winterSeasonStart: string;
  summerSeasonStart: string;
  flags: Record<LodgeBooleanField, boolean>;
  rates: Record<LodgeRateField, string>;
  amenities: AmenityRow[];
  image: LodgeImageRef | null;
  logo: LodgeImageRef | null;
};

const emptyFlags = Object.fromEntries(
  LODGE_BOOLEAN_FIELDS.map((key) => [key, false]),
) as Record<LodgeBooleanField, boolean>;

const emptyRates = Object.fromEntries(
  LODGE_RATE_FIELDS.map((key) => [key, ""]),
) as Record<LodgeRateField, string>;

const emptyForm: FormState = {
  name: "",
  location: "",
  bookingOfficerName: "",
  bookingOfficerEmail: "",
  bookingOfficerPhone: "",
  bedCapacity: "",
  siteUrl: "",
  doubleBeds: "",
  singleBeds: "",
  minutesWalkToLodge: "",
  roomType: "",
  cancellationPeriod: "",
  winterSeasonStart: "",
  summerSeasonStart: "",
  flags: emptyFlags,
  rates: emptyRates,
  amenities: [],
  image: null,
  logo: null,
};

function formFromLodge(lodge: SerializedOtherLodge): FormState {
  return {
    name: lodge.name,
    location: lodge.location ?? "",
    bookingOfficerName: lodge.bookingOfficerName ?? "",
    bookingOfficerEmail: lodge.bookingOfficerEmail ?? "",
    bookingOfficerPhone: lodge.bookingOfficerPhone ?? "",
    bedCapacity: lodge.bedCapacity === null ? "" : String(lodge.bedCapacity),
    siteUrl: lodge.siteUrl ?? "",
    doubleBeds: lodge.doubleBeds === null ? "" : String(lodge.doubleBeds),
    singleBeds: lodge.singleBeds === null ? "" : String(lodge.singleBeds),
    minutesWalkToLodge:
      lodge.minutesWalkToLodge === null ? "" : String(lodge.minutesWalkToLodge),
    roomType: lodge.roomType ?? "",
    cancellationPeriod: lodge.cancellationPeriod ?? "",
    winterSeasonStart: lodge.winterSeasonStart ?? "",
    summerSeasonStart: lodge.summerSeasonStart ?? "",
    flags: Object.fromEntries(
      LODGE_BOOLEAN_FIELDS.map((key) => [key, lodge[key]]),
    ) as Record<LodgeBooleanField, boolean>,
    rates: Object.fromEntries(
      LODGE_RATE_FIELDS.map((key) => [
        key,
        lodge[key] === null ? "" : lodge[key].toFixed(2),
      ]),
    ) as Record<LodgeRateField, string>,
    amenities: lodge.amenities.map((a) => ({
      name: a.name,
      description: a.description ?? "",
    })),
    image: lodge.image,
    logo: lodge.logo,
  };
}

// Blank text fields save as null; bed capacity parses to an integer or null.
// Amenity rows with no name are dropped (an untouched blank row is not an
// amenity), and the list is always sent so removing the last one clears it.
function countOrNull(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function formPayload(form: FormState) {
  const capacity = form.bedCapacity.trim();
  return {
    name: form.name.trim(),
    location: form.location.trim() || null,
    bookingOfficerName: form.bookingOfficerName.trim() || null,
    bookingOfficerEmail: form.bookingOfficerEmail.trim() || null,
    bookingOfficerPhone: form.bookingOfficerPhone.trim() || null,
    bedCapacity: capacity === "" ? null : Number(capacity),
    siteUrl: form.siteUrl.trim() || null,
    doubleBeds: countOrNull(form.doubleBeds),
    singleBeds: countOrNull(form.singleBeds),
    minutesWalkToLodge: countOrNull(form.minutesWalkToLodge),
    roomType: form.roomType || null,
    cancellationPeriod: form.cancellationPeriod.trim() || null,
    winterSeasonStart: form.winterSeasonStart || null,
    summerSeasonStart: form.summerSeasonStart || null,
    ...form.flags,
    ...(Object.fromEntries(
      LODGE_RATE_FIELDS.map((key) => [key, countOrNull(form.rates[key])]),
    ) as Record<LodgeRateField, number | null>),
    amenities: form.amenities
      .filter((a) => a.name.trim() !== "")
      .map((a) => ({
        name: a.name.trim(),
        description: a.description.trim() || null,
      })),
    // Always sent, so clearing a picture (null) is a real change and not an
    // omission the server would read as "leave it alone".
    imageId: form.image?.id ?? null,
    logoId: form.logo?.id ?? null,
  };
}

// dd-mm-yyyy from an ISO timestamp (UTC date part, as the API stores it).
function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

export function OtherLodgesPanel({ canManage }: { canManage: boolean }) {
  const [lodges, setLodges] = useState<SerializedOtherLodge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const loadLodges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/other-lodges");
      if (!res.ok) throw new Error("Failed to load other lodges");
      const data = (await res.json()) as { otherLodges?: SerializedOtherLodge[] };
      setLodges(Array.isArray(data?.otherLodges) ? data.otherLodges : []);
    } catch {
      setError("Could not load other lodges. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load the registry once on mount; loadLodges manages its own loading/error
    // state, which is the intended data-fetch-on-mount pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLodges();
  }, [loadLodges]);

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  function startEdit(lodge: SerializedOtherLodge) {
    setEditingId(lodge.id);
    setCreating(false);
    setForm(formFromLodge(lodge));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setCreating(false);
    setForm(emptyForm);
  }

  async function submitForm() {
    if (!form.name.trim()) {
      setError("Lodge name is required.");
      return;
    }
    const capacity = form.bedCapacity.trim();
    if (capacity !== "" && !/^\d+$/.test(capacity)) {
      setError("Bed capacity must be a whole number.");
      return;
    }
    if (capacity !== "" && Number(capacity) > 100_000) {
      setError("Bed capacity looks too large. Enter a realistic number.");
      return;
    }
    for (const [label, value] of [
      ["Double beds", form.doubleBeds],
      ["Single beds", form.singleBeds],
      ["Minutes walk to lodge", form.minutesWalkToLodge],
    ] as const) {
      const v = value.trim();
      if (v !== "" && (!/^\d+$/.test(v) || Number(v) > 100_000)) {
        setError(`${label} must be a whole number.`);
        return;
      }
    }
    for (const key of LODGE_RATE_FIELDS) {
      const v = form.rates[key].trim();
      if (v !== "" && (!RATE_PATTERN.test(v) || Number(v) > LODGE_RATE_MAX)) {
        setError(
          "Rates must be dollars and cents, for example 45 or 45.50.",
        );
        return;
      }
    }
    const named = form.amenities.filter((a) => a.name.trim() !== "");
    if (named.length > AMENITIES_PER_LODGE_MAX) {
      setError(`A lodge can have at most ${AMENITIES_PER_LODGE_MAX} amenities.`);
      return;
    }
    if (
      new Set(named.map((a) => a.name.trim().toLowerCase())).size !==
      named.length
    ) {
      setError("Amenity names must be different from each other.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const send = (allowSimilarName: boolean) =>
        fetch(creating ? "/api/admin/other-lodges" : `/api/admin/other-lodges/${editingId}`, {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...formPayload(form),
            ...(allowSimilarName ? { allowSimilarName: true } : {}),
          }),
        });
      let res = await send(false);
      let data = res.ok
        ? null
        : ((await res.json().catch(() => null)) as { error?: string; code?: string } | null);
      // Names may repeat (#69); the server asks first when one already does.
      if (res.status === 409 && data?.code === SIMILAR_LODGE_NAME_CODE) {
        if (!window.confirm(data.error ?? "Another lodge has that name. Save anyway?")) return;
        res = await send(true);
        data = res.ok
          ? null
          : ((await res.json().catch(() => null)) as { error?: string; code?: string } | null);
      }
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to save lodge");
      }
      cancelEdit();
      await loadLodges();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lodge");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLodge(lodge: SerializedOtherLodge) {
    if (
      !window.confirm(
        `Delete "${lodge.name}"${lodge.location ? ` (${lodge.location})` : ""}? It stays listed here, marked Deleted. It is hidden from the public search and from every club's lodge lists on their next download; bookings that already name it keep it. This cannot be undone.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/other-lodges/${lodge.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Failed to delete lodge");
      }
      await loadLodges();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lodge");
    } finally {
      setSaving(false);
    }
  }

  const showForm = creating || editingId !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Other lodges</h2>
          <p className="text-sm text-muted-foreground">
            The central registry of external / partner lodges. Every entry is
            shared out to every connected club.
          </p>
        </div>
        {canManage ? (
          <Button onClick={startCreate} disabled={saving || showForm}>
            <Plus className="mr-2 h-4 w-4" />
            Add other lodge
          </Button>
        ) : null}
      </div>

      {/* While the dialog is open it covers the page, so the error is shown
          inside it, next to the Save button, and not up here. */}
      {error && !showForm ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Modal
        open={showForm}
        onClose={cancelEdit}
        dismissible={!saving}
        title={creating ? "Add other lodge" : "Edit other lodge"}
        description="Only the name is required. Everything else — contact, capacity, website, facilities, seasons, rates, amenities and pictures — is optional."
      >
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ol-name">Name</Label>
                <Input
                  id="ol-name"
                  value={form.name}
                  maxLength={LODGE_NAME_MAX}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-location">Location</Label>
                <Input
                  id="ol-location"
                  value={form.location}
                  maxLength={300}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, location: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-officer-name">Booking officer&apos;s name</Label>
                <Input
                  id="ol-officer-name"
                  value={form.bookingOfficerName}
                  maxLength={200}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bookingOfficerName: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-officer-email">Booking officer&apos;s email</Label>
                <Input
                  id="ol-officer-email"
                  type="email"
                  value={form.bookingOfficerEmail}
                  maxLength={320}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bookingOfficerEmail: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-officer-phone">Booking officer&apos;s phone</Label>
                <Input
                  id="ol-officer-phone"
                  value={form.bookingOfficerPhone}
                  maxLength={50}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bookingOfficerPhone: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-beds">Bed capacity</Label>
                <Input
                  id="ol-beds"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.bedCapacity}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bedCapacity: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ol-site-url">Non-member booking page URL</Label>
                <Input
                  id="ol-site-url"
                  type="url"
                  placeholder="https://"
                  value={form.siteUrl}
                  maxLength={500}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, siteUrl: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-cancellation">Cancellation period</Label>
                <Input
                  id="ol-cancellation"
                  value={form.cancellationPeriod}
                  maxLength={200}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      cancellationPeriod: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-double-beds">Double beds</Label>
                <Input
                  id="ol-double-beds"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.doubleBeds}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, doubleBeds: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-single-beds">Single beds</Label>
                <Input
                  id="ol-single-beds"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.singleBeds}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, singleBeds: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-walk">Minutes walk to lodge</Label>
                <Input
                  id="ol-walk"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.minutesWalkToLodge}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, minutesWalkToLodge: e.target.value }))
                  }
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Room or dormitory</legend>
                <div className="flex gap-4 pt-1 text-sm">
                  {(
                    [
                      ["ROOM", "Room"],
                      ["DORMITORY", "Dormitory"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="ol-room-type"
                        className="h-4 w-4 accent-[var(--primary)]"
                        checked={form.roomType === value}
                        onChange={() =>
                          setForm((p) => ({ ...p, roomType: value }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="ol-winter-start">Winter season start date</Label>
                <Input
                  id="ol-winter-start"
                  type="date"
                  value={form.winterSeasonStart}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      winterSeasonStart: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ol-summer-start">Summer season start date</Label>
                <Input
                  id="ol-summer-start"
                  type="date"
                  value={form.summerSeasonStart}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      summerSeasonStart: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Non-member rates per person per night (NZD, incl. GST)
              </legend>
              <p className="text-xs text-muted-foreground">
                Shown on the public booking search. Leave blank if not known.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="sr-only">
                        Season
                      </th>
                      {RATE_AGE_GROUPS.map((group) => (
                        <th
                          key={group}
                          scope="col"
                          className="px-1 pb-1 text-left font-normal text-muted-foreground"
                        >
                          {group}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {RATE_GRID.map(({ season, fields }) => (
                      <tr key={season}>
                        <th scope="row" className="pr-2 text-left font-normal">
                          {season}
                        </th>
                        {fields.map((key, i) => (
                          <td key={key} className="px-1 py-1">
                            <Input
                              aria-label={`${season} rate, ${RATE_AGE_GROUPS[i]}`}
                              inputMode="decimal"
                              value={form.rates[key]}
                              onChange={(e) =>
                                setForm((p) => ({
                                  ...p,
                                  rates: { ...p.rates, [key]: e.target.value },
                                }))
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <ImagePicker
                kind="IMAGE"
                label="Lodge image"
                value={form.image}
                disabled={saving}
                onChange={(image) => setForm((p) => ({ ...p, image }))}
              />
              <ImagePicker
                kind="LOGO"
                label="Lodge logo"
                value={form.logo}
                disabled={saving}
                onChange={(logo) => setForm((p) => ({ ...p, logo }))}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Facilities</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {BOOLEAN_FIELDS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--primary)]"
                      checked={form.flags[key]}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          flags: { ...p.flags, [key]: e.target.checked },
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Amenities</legend>
              {form.amenities.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No amenities. Add anything else the lodge offers.
                </p>
              ) : null}
              {form.amenities.map((amenity, index) => (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
                >
                  <Input
                    aria-label={`Amenity ${index + 1} name`}
                    placeholder="Name"
                    value={amenity.name}
                    maxLength={AMENITY_NAME_MAX}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        amenities: p.amenities.map((a, i) =>
                          i === index ? { ...a, name: e.target.value } : a,
                        ),
                      }))
                    }
                  />
                  <Input
                    aria-label={`Amenity ${index + 1} description`}
                    placeholder="Description (optional)"
                    value={amenity.description}
                    maxLength={AMENITY_DESCRIPTION_MAX}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        amenities: p.amenities.map((a, i) =>
                          i === index
                            ? { ...a, description: e.target.value }
                            : a,
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove amenity ${index + 1}`}
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        amenities: p.amenities.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={form.amenities.length >= AMENITIES_PER_LODGE_MAX}
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    amenities: [...p.amenities, { name: "", description: "" }],
                  }))
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add amenity
              </Button>
            </fieldset>

            <div className="flex gap-2">
              <Button onClick={() => void submitForm()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
        </>
      </Modal>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Registry
          </CardTitle>
          <CardDescription>
            Every entry is handed out to connected clubs via their API key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading other lodges…</p>
          ) : lodges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other lodges yet.{canManage ? " Use “Add other lodge” to add one." : ""}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Booking officer</TableHead>
                    <TableHead className="text-right">Beds</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Source</TableHead>
                    {canManage ? (
                      <TableHead className="text-right">Actions</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lodges.map((lodge) => (
                    <TableRow
                      key={lodge.id}
                      // A deleted lodge (#16) stays listed, faded red, and can
                      // no longer be edited or deleted.
                      className={lodge.deletedAt ? "bg-destructive/10" : undefined}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {lodge.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={lodge.logo.url}
                              alt={`${lodge.name} logo`}
                              className="h-8 w-8 object-contain"
                            />
                          ) : null}
                          <span className="group relative">
                            <span
                              className="font-medium"
                              tabIndex={lodge.amenities.length > 0 ? 0 : undefined}
                            >
                              {lodge.name}
                            </span>
                            {lodge.deletedAt ? (
                              <span className="ml-2 rounded bg-red-700 px-1.5 py-0.5 text-xs font-medium text-white dark:bg-red-300 dark:text-red-950">
                                Deleted {formatDate(lodge.deletedAt)}
                              </span>
                            ) : null}
                            {lodge.amenities.length > 0 ? (
                              <span
                                role="tooltip"
                                className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-64 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md group-focus-within:block group-hover:block"
                              >
                                <span className="mb-1 block font-semibold">
                                  Amenities
                                </span>
                                <ul className="list-disc space-y-0.5 pl-4">
                                  {lodge.amenities.map((a) => (
                                    <li key={a.name}>
                                      {a.name}
                                      {a.description ? (
                                        <span className="text-muted-foreground">
                                          {" "}
                                          – {a.description}
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </span>
                            ) : null}
                          </span>
                        </div>
                        {lodge.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={lodge.image.url}
                            alt={`${lodge.name}`}
                            loading="lazy"
                            className="mt-2 h-16 w-28 rounded object-cover"
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lodge.location ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {lodge.bookingOfficerName ? (
                          <div>
                            <div>{lodge.bookingOfficerName}</div>
                            {lodge.bookingOfficerEmail ? (
                              <div className="text-xs">{lodge.bookingOfficerEmail}</div>
                            ) : null}
                            {lodge.bookingOfficerPhone ? (
                              <div className="text-xs">{lodge.bookingOfficerPhone}</div>
                            ) : null}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lodge.bedCapacity ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-xs break-all text-xs text-muted-foreground">
                        {lodge.siteUrl && /^https?:\/\//i.test(lodge.siteUrl) ? (
                          <a
                            href={lodge.siteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            {lodge.siteUrl}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        updated by {lodge.lastUpdatedByClub?.code ?? "admin"} on{" "}
                        {formatDate(lodge.lastUploadedAt ?? lodge.updatedAt)}
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          {lodge.deletedAt ? null : (
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => startEdit(lodge)}
                                disabled={saving}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void deleteLodge(lodge)}
                                disabled={saving}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
