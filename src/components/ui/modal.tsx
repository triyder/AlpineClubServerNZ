"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A modal dialog on the platform's native `<dialog>` element.
 *
 * `showModal()` gives, with no dependency, what a hand-rolled overlay has to
 * rebuild: the page behind is inert, focus is trapped inside and returned to the
 * trigger on close, and Escape closes it.
 *
 * Two deliberate choices, both about not losing someone's typing:
 * - Clicking the dim backdrop does NOT close it. An edit form is long, and a
 *   stray click outside would throw it away.
 * - While `dismissible` is false (a save is in flight) Escape and the close
 *   button do nothing, so the form cannot disappear mid-request.
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

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape: refuse while a save is in flight, otherwise let the browser
      // close it and `onClose` below syncs the caller's state.
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      onClose={onClose}
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
                <p className="mt-1.5 text-sm text-muted-foreground">
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
