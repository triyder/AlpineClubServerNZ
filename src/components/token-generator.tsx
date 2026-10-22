"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TokenReveal } from "@/components/token-reveal";

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
    return <TokenReveal plaintext={plaintext} onDone={() => setPlaintext(null)} />;
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
