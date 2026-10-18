"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

/**
 * "Email the club" (owner, 18 Oct 2026), in place of "Book with the club" for a
 * lodge with no non-member booking page but a booking officer's email.
 *
 * Pressing it asks the server for the address (`/book/email/:id`, so the
 * address is never in the page for a crawler to collect), copies it to the
 * clipboard with a "copied" note, and opens the guest's email program on a
 * message to it with the subject and body filled in. Where the clipboard is
 * refused, the note shows the address to copy by hand.
 */

type Note = { kind: "copied" } | { kind: "shown"; email: string } | { kind: "failed" } | null;

export function EmailClubButton({
  lodgeId,
  lodgeName,
  subject,
  body,
}: {
  lodgeId: string;
  lodgeName: string;
  subject: string;
  body: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  // The "copied" note fades after a few seconds; a shown address stays.
  useEffect(() => {
    if (note?.kind !== "copied" && note?.kind !== "failed") return;
    const timer = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [note]);

  async function emailTheClub() {
    setBusy(true);
    try {
      const res = await fetch(`/book/email/${encodeURIComponent(lodgeId)}`, { cache: "no-store" });
      const data = res.ok ? ((await res.json().catch(() => null)) as { email?: string } | null) : null;
      const email = data?.email;
      if (!email) {
        setNote({ kind: "failed" });
        return;
      }
      try {
        await navigator.clipboard.writeText(email);
        setNote({ kind: "copied" });
      } catch {
        setNote({ kind: "shown", email });
      }
      const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?${query}`;
    } catch {
      setNote({ kind: "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex flex-col">
      <button
        type="button"
        onClick={emailTheClub}
        disabled={busy}
        aria-describedby={note ? `email-note-${lodgeId}` : undefined}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
      >
        <Mail aria-hidden className="h-4 w-4" />
        Email the club
        <span className="sr-only">(opens an email to {lodgeName}&apos;s booking officer)</span>
      </button>
      {note ? (
        <p
          id={`email-note-${lodgeId}`}
          role="status"
          className="absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[16rem] -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-center text-xs font-medium text-background shadow-lg"
        >
          {note.kind === "copied"
            ? "Email address copied to clipboard"
            : note.kind === "shown"
              ? `Email: ${note.email}`
              : "The email address could not be fetched. Please try again."}
        </p>
      ) : null}
    </div>
  );
}
