"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shows a freshly minted API key exactly once, with a copy button (#30).
 *
 * The one reveal used by the admin's key generator on the Connections page and
 * by a club's own registration-complete page, so the warning, the copy
 * affordance and the "shown once" rule cannot drift between the two. The
 * plaintext lives only in this component's props: the server never returns it
 * again, and nothing here persists it.
 */
export function TokenReveal({
  plaintext,
  instruction,
  onDone,
}: {
  plaintext: string;
  /** What to do with the key, in the holder's words; defaults to the admin's. */
  instruction?: string;
  /** Offered as a "Done" button when the holder can dismiss the key. */
  onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="space-y-2 rounded-md border border-border bg-muted/40 p-3"
      data-testid="token-reveal"
    >
      <p className="text-xs font-medium text-warning">
        Copy this key now — it will not be shown again.
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
      {instruction ? (
        <p className="text-xs text-muted-foreground">{instruction}</p>
      ) : null}
      {onDone ? (
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      ) : null}
    </div>
  );
}
