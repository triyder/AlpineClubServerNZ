"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Client island for issuing a new API key to an approved club. On success it
 * shows the plaintext token ONCE (the server never returns it again) with a
 * copy button, then refreshes the server component so the new token row shows.
 */
export function TokenGenerator({ clubId }: { clubId: string }) {
  const router = useRouter();
  const [name, setName] = useState("Default key");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clubs/${clubId}/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate token.");
        return;
      }
      setPlaintext(data.plaintext);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setPending(false);
    }
  }

  if (plaintext) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs font-medium text-warning">
          Copy this token now — it will not be shown again.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
            {plaintext}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(plaintext);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPlaintext(null)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name"
          className="h-8 max-w-48"
        />
        <Button size="sm" onClick={generate} disabled={pending}>
          {pending ? "Generating…" : "Generate API key"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
