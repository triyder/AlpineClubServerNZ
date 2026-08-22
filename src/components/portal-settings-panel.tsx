"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Settings {
  retentionDays: number;
  autoHideThreshold: number;
  autoHideMinClubs: number;
  tombstoneHorizonDays: number;
}

interface CleanupStats {
  skipped?: string;
  expired: number;
  stubsPruned: number;
  imagesDeleted: number;
  filesUnlinked: number;
  skippedUnderReview: number;
  orphansCollected: number;
  durationMs: number;
}

const RETENTION_CHOICES = [
  { days: 90, label: "3 months" },
  { days: 183, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1826, label: "5 years" },
  { days: 0, label: "Disabled — keep everything" },
];

/**
 * Settings arrive from the server component, so there is no fetch-on-mount and
 * no loading state to get wrong.
 */
export function PortalSettingsPanel({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState<Settings>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [stats, setStats] = useState<CleanupStats | null>(null);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function runCleanup() {
    setCleaning(true);
    setError(null);
    setNotice(null);
    setStats(null);
    try {
      const res = await fetch("/api/admin/settings/cleanup", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Cleanup failed");
      setStats((await res.json()).stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run cleanup");
    } finally {
      setCleaning(false);
    }
  }

  const set = (patch: Partial<Settings>) =>
    setSettings({ ...settings, ...patch });

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {notice}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="retention">Keep network posts for</Label>
            <select
              id="retention"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={settings.retentionDays}
              onChange={(e) => set({ retentionDays: Number(e.target.value) })}
            >
              {RETENTION_CHOICES.map((c) => (
                <option key={c.days} value={c.days}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">
              Expired posts are blanked and their images deleted, then reported
              to every club as removed on its next sync. Posts with open reports
              are left alone — they are evidence until someone has ruled on them.
            </p>
            <p className="text-sm text-muted-foreground">
              This only deletes content across the network if each club&rsquo;s
              install applies the removals it is sent. A club running a modified
              or long-stale install keeps its copies.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Auto-hide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="threshold">Reports needed to hide a post</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                value={settings.autoHideThreshold}
                onChange={(e) =>
                  set({ autoHideThreshold: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minClubs">Distinct clubs also required</Label>
              <Input
                id="minClubs"
                type="number"
                min={1}
                value={settings.autoHideMinClubs}
                onChange={(e) =>
                  set({ autoHideMinClubs: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            A hidden post is not a verdict — it drops out of every club&rsquo;s
            feed and waits for you on the Posts screen, where you can restore it.
          </p>
          <p className="text-sm text-muted-foreground">
            Reporter identity is asserted by the reporting club and cannot be
            verified here, so one club&rsquo;s install could in principle
            manufacture reports. Raising &ldquo;distinct clubs&rdquo; to 2 is the
            lever if that ever happens.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mirror convergence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="horizon">Keep removal records for (days)</Label>
            <Input
              id="horizon"
              type="number"
              min={1}
              className="max-w-40"
              value={settings.tombstoneHorizonDays}
              onChange={(e) =>
                set({ tombstoneHorizonDays: Number(e.target.value) })
              }
            />
            <p className="text-sm text-muted-foreground">
              How long a removed post&rsquo;s record survives so clubs can learn
              it is gone. A club offline longer than this has to discard its copy
              of the feed and rebuild it, so set this comfortably longer than any
              outage you would expect.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void runCleanup()}
          disabled={cleaning}
        >
          {cleaning ? "Running…" : "Run cleanup now"}
        </Button>
      </div>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Last cleanup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {stats.skipped === "already-running" ? (
              <p>
                A cleanup pass was already running, so this one did nothing. Try
                again shortly.
              </p>
            ) : (
              <>
                {stats.skipped === "disabled" && (
                  <p className="text-muted-foreground">
                    Retention is disabled, so no posts were expired. Removal
                    records and orphaned files were still tidied up.
                  </p>
                )}
                <p>Posts expired: {stats.expired}</p>
                <p>Removal records pruned: {stats.stubsPruned}</p>
                <p>
                  Images deleted: {stats.imagesDeleted} ({stats.filesUnlinked}{" "}
                  files removed from disk)
                </p>
                <p>Left alone, still under review: {stats.skippedUnderReview}</p>
                <p>Orphaned files collected: {stats.orphansCollected}</p>
                <p className="text-muted-foreground">
                  Took {stats.durationMs} ms
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
