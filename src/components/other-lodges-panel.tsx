"use client";

import { useCallback, useEffect, useState } from "react";
import { Building, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SerializedOtherLodge } from "@/lib/other-lodges";

type FormState = {
  name: string;
  location: string;
  bookingOfficerName: string;
  bookingOfficerEmail: string;
  bookingOfficerPhone: string;
  bedCapacity: string;
  distribute: boolean;
};

const emptyForm: FormState = {
  name: "",
  location: "",
  bookingOfficerName: "",
  bookingOfficerEmail: "",
  bookingOfficerPhone: "",
  bedCapacity: "",
  distribute: false,
};

function formFromLodge(lodge: SerializedOtherLodge): FormState {
  return {
    name: lodge.name,
    location: lodge.location ?? "",
    bookingOfficerName: lodge.bookingOfficerName ?? "",
    bookingOfficerEmail: lodge.bookingOfficerEmail ?? "",
    bookingOfficerPhone: lodge.bookingOfficerPhone ?? "",
    bedCapacity: lodge.bedCapacity === null ? "" : String(lodge.bedCapacity),
    distribute: lodge.distribute,
  };
}

// Blank text fields save as null; bed capacity parses to an integer or null.
function formPayload(form: FormState) {
  const capacity = form.bedCapacity.trim();
  return {
    name: form.name.trim(),
    location: form.location.trim() || null,
    bookingOfficerName: form.bookingOfficerName.trim() || null,
    bookingOfficerEmail: form.bookingOfficerEmail.trim() || null,
    bookingOfficerPhone: form.bookingOfficerPhone.trim() || null,
    bedCapacity: capacity === "" ? null : Number(capacity),
    distribute: form.distribute,
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

  async function toggleDistribute(lodge: SerializedOtherLodge) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/other-lodges/${lodge.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distribute: !lodge.distribute }),
      });
      if (!res.ok) throw new Error("Failed to update distribution");
      await loadLodges();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
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
            The central registry of external / partner lodges. Entries marked{" "}
            <strong>Distribute</strong> are shared out to every connected club.
          </p>
        </div>
        {canManage ? (
          <Button onClick={startCreate} disabled={saving || showForm}>
            <Plus className="mr-2 h-4 w-4" />
            Add other lodge
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {creating ? "Add other lodge" : "Edit other lodge"}
            </CardTitle>
            <CardDescription>
              Only the name is required. Everything else is optional contact and
              capacity detail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={form.distribute}
                onChange={(e) =>
                  setForm((p) => ({ ...p, distribute: e.target.checked }))
                }
              />
              Distribute this lodge to all connected clubs
            </label>
            <div className="flex gap-2">
              <Button onClick={() => void submitForm()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Registry
          </CardTitle>
          <CardDescription>
            Entries marked for distribution are handed out to connected clubs via
            their API key.
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
                    <TableHead>Source</TableHead>
                    <TableHead>Distribution</TableHead>
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
                      <TableCell className="text-muted-foreground">
                        {lodge.sourceClub ? (
                          <span title={lodge.sourceClub.code}>
                            {lodge.sourceClub.name}
                          </span>
                        ) : (
                          <span className="text-xs">central</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => void toggleDistribute(lodge)}
                            disabled={saving}
                            className="disabled:opacity-50"
                            title="Toggle distribution"
                          >
                            <Badge variant={lodge.distribute ? "success" : "secondary"}>
                              {lodge.distribute ? "Distributing" : "Not distributed"}
                            </Badge>
                          </button>
                        ) : (
                          <Badge variant={lodge.distribute ? "success" : "secondary"}>
                            {lodge.distribute ? "Distributing" : "Not distributed"}
                          </Badge>
                        )}
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
