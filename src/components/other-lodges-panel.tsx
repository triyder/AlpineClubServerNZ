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
import type { SerializedOtherLodge } from "@/lib/other-lodges";

type BooleanFieldKey =
  | "requiresLodgeCustodian"
  | "freeWifi"
  | "quietRoom"
  | "dryingRoom"
  | "sharedKitchen"
  | "wheelchairAccessible"
  | "breakfastIncluded"
  | "lunchIncluded"
  | "dinnerIncluded";

// `satisfies` keeps this list in step with SerializedOtherLodge: a key that is
// not a boolean field on the lodge is a type error.
const BOOLEAN_FIELDS: { key: BooleanFieldKey; label: string }[] = [
  { key: "requiresLodgeCustodian", label: "Requires lodge custodian" },
  { key: "freeWifi", label: "Free wifi" },
  { key: "quietRoom", label: "Quiet room" },
  { key: "dryingRoom", label: "Drying room" },
  { key: "sharedKitchen", label: "Shared kitchen" },
  { key: "wheelchairAccessible", label: "Wheelchair accessible" },
  { key: "breakfastIncluded", label: "Breakfast included" },
  { key: "lunchIncluded", label: "Lunch included" },
  { key: "dinnerIncluded", label: "Dinner included" },
] satisfies { key: keyof SerializedOtherLodge; label: string }[];

type AmenityRow = { name: string; description: string };

type FormState = {
  name: string;
  location: string;
  bookingOfficerName: string;
  bookingOfficerEmail: string;
  bookingOfficerPhone: string;
  bedCapacity: string;
  siteUrl: string;
  bookingPath: string;
  cancellationPeriod: string;
  winterSeasonStart: string;
  summerSeasonStart: string;
  flags: Record<BooleanFieldKey, boolean>;
  amenities: AmenityRow[];
};

const emptyFlags: Record<BooleanFieldKey, boolean> = {
  requiresLodgeCustodian: false,
  freeWifi: false,
  quietRoom: false,
  dryingRoom: false,
  sharedKitchen: false,
  wheelchairAccessible: false,
  breakfastIncluded: false,
  lunchIncluded: false,
  dinnerIncluded: false,
};

const emptyForm: FormState = {
  name: "",
  location: "",
  bookingOfficerName: "",
  bookingOfficerEmail: "",
  bookingOfficerPhone: "",
  bedCapacity: "",
  siteUrl: "",
  bookingPath: "",
  cancellationPeriod: "",
  winterSeasonStart: "",
  summerSeasonStart: "",
  flags: emptyFlags,
  amenities: [],
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
    bookingPath: lodge.bookingPath ?? "",
    cancellationPeriod: lodge.cancellationPeriod ?? "",
    winterSeasonStart: lodge.winterSeasonStart ?? "",
    summerSeasonStart: lodge.summerSeasonStart ?? "",
    flags: Object.fromEntries(
      BOOLEAN_FIELDS.map(({ key }) => [key, lodge[key]]),
    ) as Record<BooleanFieldKey, boolean>,
    amenities: lodge.amenities.map((a) => ({
      name: a.name,
      description: a.description ?? "",
    })),
  };
}

// Blank text fields save as null; bed capacity parses to an integer or null.
// Amenity rows with no name are dropped (an untouched blank row is not an
// amenity), and the list is always sent so removing the last one clears it.
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
    bookingPath: form.bookingPath.trim() || null,
    cancellationPeriod: form.cancellationPeriod.trim() || null,
    winterSeasonStart: form.winterSeasonStart || null,
    summerSeasonStart: form.summerSeasonStart || null,
    ...form.flags,
    amenities: form.amenities
      .filter((a) => a.name.trim() !== "")
      .map((a) => ({
        name: a.name.trim(),
        description: a.description.trim() || null,
      })),
  };
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
    const named = form.amenities.filter((a) => a.name.trim() !== "");
    if (named.length > 50) {
      setError("A lodge can have at most 50 amenities.");
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
      const res = creating
        ? await fetch("/api/admin/other-lodges", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formPayload(form)),
          })
        : await fetch(`/api/admin/other-lodges/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formPayload(form)),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
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
        `Delete "${lodge.name}"? This removes it from the registry for good.`,
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
        description="Only the name is required. Everything else is optional contact and capacity detail."
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
                  maxLength={120}
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
                <Label htmlFor="ol-site-url">Site URL</Label>
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
                <Label htmlFor="ol-booking-path">Booking path</Label>
                <Input
                  id="ol-booking-path"
                  value={form.bookingPath}
                  maxLength={300}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, bookingPath: e.target.value }))
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
              <div className="hidden sm:block" />
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
                    maxLength={120}
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
                    maxLength={1000}
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
                disabled={form.amenities.length >= 50}
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
                    <TableRow key={lodge.id}>
                      <TableCell>
                        <span className="font-medium">{lodge.name}</span>
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
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {lodge.siteUrl && /^https?:\/\//i.test(lodge.siteUrl) ? (
                          <div>
                            <a
                              href={lodge.siteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {lodge.siteUrl}
                            </a>
                            {lodge.bookingPath ? ` · ${lodge.bookingPath}` : ""}
                          </div>
                        ) : null}
                        {BOOLEAN_FIELDS.filter(({ key }) => lodge[key]).length >
                        0 ? (
                          <div>
                            {BOOLEAN_FIELDS.filter(({ key }) => lodge[key])
                              .map(({ label }) => label)
                              .join(", ")}
                          </div>
                        ) : null}
                        {lodge.cancellationPeriod ? (
                          <div>Cancellation: {lodge.cancellationPeriod}</div>
                        ) : null}
                        {lodge.winterSeasonStart || lodge.summerSeasonStart ? (
                          <div>
                            {lodge.winterSeasonStart
                              ? `Winter from ${lodge.winterSeasonStart}`
                              : ""}
                            {lodge.winterSeasonStart && lodge.summerSeasonStart
                              ? " · "
                              : ""}
                            {lodge.summerSeasonStart
                              ? `Summer from ${lodge.summerSeasonStart}`
                              : ""}
                          </div>
                        ) : null}
                        {lodge.amenities.length > 0 ? (
                          <div title={lodge.amenities.map((a) => a.name).join(", ")}>
                            {lodge.amenities.length} amenit
                            {lodge.amenities.length === 1 ? "y" : "ies"}:{" "}
                            {lodge.amenities.map((a) => a.name).join(", ")}
                          </div>
                        ) : null}
                        {!lodge.siteUrl &&
                        !lodge.cancellationPeriod &&
                        !lodge.winterSeasonStart &&
                        !lodge.summerSeasonStart &&
                        lodge.amenities.length === 0 &&
                        BOOLEAN_FIELDS.every(({ key }) => !lodge[key])
                          ? "—"
                          : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div>
                          {lodge.sourceClub ? (
                            <span title={lodge.sourceClub.code}>
                              {lodge.sourceClub.name}
                            </span>
                          ) : (
                            <span className="text-xs">central</span>
                          )}
                          {lodge.lastUpdatedByClub ? (
                            <div className="text-xs">
                              updated by {lodge.lastUpdatedByClub.name}
                              {lodge.lastUploadedAt
                                ? ` · ${lodge.lastUploadedAt.slice(0, 10)}`
                                : ""}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      {canManage ? (
                        <TableCell>
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
