"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MailSecurity, MailSettingsView } from "@/lib/mail";

/**
 * Settings → Email (#33): the SMTP server this console sends through.
 *
 * The password field is write-only: the server reports only whether one is
 * set, and an empty field on save keeps the stored one. "Send a test message"
 * goes to the signed-in administrator's own address, never to a typed one.
 */
export function EmailSettingsPanel({
  initial,
  adminEmail,
}: {
  initial: MailSettingsView;
  adminEmail: string;
}) {
  const [settings, setSettings] = useState<MailSettingsView>(initial);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const set = (patch: Partial<MailSettingsView>) => setSettings({ ...settings, ...patch });

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { passwordSet: _ignored, ...fields } = settings;
      const res = await fetch("/api/admin/settings/email", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, ...(password ? { password } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSettings(data.settings);
      setPassword("");
      setNotice("Email settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save email settings");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/settings/email/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The test message was not sent");
      setNotice(`Test message sent to ${data.to}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the test message");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Email (SMTP)</CardTitle>
        <CardDescription>
          The mail server this console sends through: the administrator digest and
          anything else that must reach you. Save, then send yourself a test message.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div
            className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm" role="status">
            {notice}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smtp-host">Host</Label>
            <Input
              id="smtp-host"
              value={settings.host}
              placeholder="smtp.example.net"
              onChange={(e) => set({ host: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              type="number"
              min={1}
              max={65535}
              value={settings.port}
              onChange={(e) => set({ port: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-security">Connection</Label>
            <select
              id="smtp-security"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={settings.security}
              onChange={(e) => set({ security: e.target.value as MailSecurity })}
            >
              <option value="starttls">STARTTLS (usually port 587)</option>
              <option value="tls">TLS from the start (usually port 465)</option>
              <option value="none">None (a local relay only)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-user">Username</Label>
            <Input
              id="smtp-user"
              value={settings.user}
              autoComplete="off"
              onChange={(e) => set({ user: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-password">
              Password {settings.passwordSet ? "(set — leave blank to keep it)" : ""}
            </Label>
            <Input
              id="smtp-password"
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder={settings.passwordSet ? "••••••••" : ""}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-from">From address</Label>
            <Input
              id="smtp-from"
              type="email"
              value={settings.fromAddress}
              placeholder="server@example.nz"
              onChange={(e) => set({ fromAddress: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-from-name">From name</Label>
            <Input
              id="smtp-from-name"
              value={settings.fromName}
              placeholder="Alpine Club Server"
              onChange={(e) => set({ fromName: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save email settings"}
          </Button>
          <Button variant="outline" onClick={sendTest} disabled={testing || !settings.host}>
            {testing ? "Sending…" : `Send a test message to ${adminEmail}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
