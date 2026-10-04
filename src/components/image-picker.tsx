"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ImageKindValue,
  LodgeImageRef,
  SerializedImage,
} from "@/lib/image-library";

/**
 * Choose one picture of a given type from the image library.
 *
 * Only pictures of `kind` are ever offered, which is what keeps a logo out of
 * the lodge-image slot (the server refuses a mismatch as well). The library is
 * fetched when the chooser is first opened, not on every render of the form.
 */
export function ImagePicker({
  kind,
  label,
  value,
  onChange,
  disabled = false,
}: {
  kind: ImageKindValue;
  label: string;
  value: LodgeImageRef | null;
  onChange: (next: LodgeImageRef | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SerializedImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openChooser() {
    setOpen(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/images?kind=${kind}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { images?: SerializedImage[] };
      setOptions(Array.isArray(data.images) ? data.images : []);
    } catch {
      setError("Could not load the image library. Please try again.");
    }
  }

  const noun = kind === "LOGO" ? "logo" : "lodge image";

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-20 w-28 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {value ? (
            // A stored library picture at a capability URL; not worth next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value.url}
              alt={value.name}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="px-2 text-center text-xs text-muted-foreground">
              None chosen
            </span>
          )}
        </div>
        <div className="space-y-1">
          {value ? (
            <p className="text-sm">{value.name}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => (open ? setOpen(false) : void openChooser())}
            >
              {open ? "Close" : value ? `Change ${noun}` : `Choose ${noun}`}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onChange(null)}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : options === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {noun}s uploaded yet. Upload one in the{" "}
              <a href="/admin/image-manager" className="underline">
                image manager
              </a>
              , then come back.
            </p>
          ) : (
            <ul className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
              {options.map((image) => (
                <li key={image.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: image.id, name: image.name, url: image.url });
                      setOpen(false);
                    }}
                    aria-pressed={value?.id === image.id}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-md border border-border p-1 text-left hover:bg-accent",
                      value?.id === image.id && "ring-2 ring-primary",
                    )}
                  >
                    <span className="flex h-16 items-center justify-center bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt=""
                        loading="lazy"
                        className="max-h-full max-w-full object-contain"
                      />
                    </span>
                    <span className="truncate text-xs">{image.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}
