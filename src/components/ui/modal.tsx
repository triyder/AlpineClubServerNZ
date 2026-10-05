"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { decideDialogClose } from "@/components/ui/modal-close";

/**
 * A modal dialog on the platform's native `<dialog>` element.
 *
 * `showModal()` gives, with no dependency, what a hand-rolled overlay has to
 * rebuild: the page behind is inert, focus is trapped inside and returned to the
 * trigger on close, and Escape closes it. The page behind is also kept from
 * scrolling while it is open.
 *
 * Two deliberate choices, both about not losing someone's typing:
 * - Clicking the dim backdrop does NOT close it. An edit form is long, and a
 *   stray click outside would throw it away.
 * - While `dismissible` is false (a save is in flight) the close button is
 *   disabled and Escape is refused — and because Chromium closes a dialog
 *   regardless on a second Escape in the same user activation, a `close` that
 *   arrives while the caller still wants it open re-shows it instead of
 *   closing the form mid-request (`decideDialogClose`). That is a re-show, not
 *   a guarantee the keystroke was swallowed: the dialog may blink.
 *
 * Children are mounted only while open, so a closed dialog holds no form state.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  dismissible = true,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  dismissible?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Lock the page's scroll while open; restore whatever was there on close or
  // unmount.
  React.useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape: refuse while a save is in flight, otherwise let the browser
      // close it and `onClose` below syncs the caller's state.
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      // The handler is re-attached on every render, so `open` and `dismissible`
      // here are the props at the moment of the event, not a stale closure.
      onClose={() => {
        const action = decideDialogClose({ dismissible, wantedOpen: open });
        if (action === "reopen") {
          // Guarded: showModal() throws if it is somehow still open, and it
          // fires no `close`, so this cannot loop.
          const dialog = ref.current;
          if (dialog && !dialog.open) dialog.showModal();
          return;
        }
        onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-3xl rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold leading-none">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={!dismissible}
              onClick={() => ref.current?.close()}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-6 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
