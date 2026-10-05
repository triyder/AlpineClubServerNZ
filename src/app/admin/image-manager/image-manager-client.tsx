"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Pencil, Trash2, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  IMAGE_NAME_MAX,
  LIBRARY_MAX_FILES as MAX_FILES,
  MAX_IMAGE_BYTES_TOTAL as MAX_TOTAL_BYTES,
  type ImageKindValue,
  type SerializedImage,
} from "@/lib/image-library";

// The batch limits are the server's own, so a bad batch is explained before
// it is sent and the two cannot drift apart.
const ACCEPT = "image/jpeg,image/png,image/webp";

type Filter = "ALL" | ImageKindValue;

const KIND_LABEL: Record<ImageKindValue, string> = {
  IMAGE: "Lodge image",
  LOGO: "Logo",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageManagerClient() {
  const [images, setImages] = useState<SerializedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  const [kind, setKind] = useState<ImageKindValue>("IMAGE");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<
    Array<{ filename: string; error: string }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const [renaming, setRenaming] = useState<SerializedImage | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/images");
      if (!res.ok) throw new Error("Failed to load images");
      const data = (await res.json()) as { images?: SerializedImage[] };
      setImages(Array.isArray(data.images) ? data.images : []);
    } catch {
      setError("Could not load the image library. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load the library once on mount; `load` manages its own state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function uploadFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    setError(null);
    setRejected([]);

    if (files.length > MAX_FILES) {
      setError(`Upload at most ${MAX_FILES} pictures at a time.`);
      return;
    }
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      setError(
        `These pictures total ${formatBytes(total)}; the limit for one upload is ${formatBytes(MAX_TOTAL_BYTES)}. Upload fewer at a time.`,
      );
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      for (const file of files) form.append("files", file);
      const res = await fetch("/api/admin/images", { method: "POST", body: form });
      // A body over the proxy's cap is refused at the edge as a bare 413 with no
      // JSON, so the message below cannot rely on one.
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        rejected?: Array<{ filename: string; error: string }>;
      } | null;
      if (data?.rejected?.length) setRejected(data.rejected);
      if (!res.ok && !data?.rejected?.length) {
        throw new Error(
          data?.error ??
            (res.status === 413
              ? "That upload was too large. Upload fewer or smaller pictures."
              : "Upload failed."),
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function startRename(image: SerializedImage) {
    setRenaming(image);
    setRenameValue(image.name);
    setRenameError(null);
  }

  async function submitRename() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError("Enter a name.");
      return;
    }
    setBusy(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/admin/images/${renaming.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not rename the picture.");
      }
      setRenaming(null);
      await load();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Could not rename.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(image: SerializedImage) {
    if (!window.confirm(`Delete "${image.name}"? This removes the file for good.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/images/${image.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not delete the picture.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  const shown = images.filter((i) => filter === "ALL" || i.kind === filter);
  const counts = {
    ALL: images.length,
    IMAGE: images.filter((i) => i.kind === "IMAGE").length,
    LOGO: images.filter((i) => i.kind === "LOGO").length,
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5" />
            Upload
          </CardTitle>
          <CardDescription>
            JPEG, PNG or WebP. Up to {MAX_FILES} pictures and{" "}
            {formatBytes(MAX_TOTAL_BYTES)} in total per upload. Pictures are
            resized and re-saved as WebP, and any location data in them is
            removed. Logos keep their transparency and are stored smaller.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">These pictures are</legend>
            <div className="flex flex-wrap gap-4">
              {(Object.keys(KIND_LABEL) as ImageKindValue[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  {k === "IMAGE" ? "Lodge images" : "Logos"}
                </label>
              ))}
            </div>
          </fieldset>

          <div
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              e.preventDefault();
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) {
                dragDepth.current = 0;
                setDragging(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (!uploading) void uploadFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground",
              dragging && "border-primary bg-accent",
            )}
          >
            <UploadCloud className="h-8 w-8" />
            <p>{uploading ? "Uploading…" : "Drag pictures here, or"}</p>
            <input
              ref={fileInputRef}
              id="image-files"
              type="file"
              multiple
              accept={ACCEPT}
              disabled={uploading}
              aria-label="Pictures to upload"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) void uploadFiles(e.target.files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose files
            </Button>
          </div>

          {rejected.length > 0 ? (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              <p>Some pictures could not be stored:</p>
              <ul className="list-disc pl-5">
                {rejected.map((r, i) => (
                  <li key={`${r.filename}-${i}`}>
                    {r.filename}: {r.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                Library
              </CardTitle>
              <CardDescription>
                {counts.ALL} picture{counts.ALL === 1 ? "" : "s"}. Choose them
                for a lodge on the Lodges page.
              </CardDescription>
            </div>
            <div className="flex gap-1 text-xs">
              {(
                [
                  ["ALL", `All (${counts.ALL})`],
                  ["IMAGE", `Lodge images (${counts.IMAGE})`],
                  ["LOGO", `Logos (${counts.LOGO})`],
                ] as Array<[Filter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded border border-border px-2 py-1 hover:bg-accent",
                    filter === value && "bg-accent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading pictures…</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {images.length === 0
                ? "No pictures yet. Upload one above."
                : "No pictures of this type."}
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((image) => (
                <li
                  key={image.id}
                  className="flex flex-col overflow-hidden rounded-lg border border-border"
                >
                  <div className="flex h-40 items-center justify-center bg-muted">
                    {/* A stored library picture at a capability URL; next/image's
                        optimiser is no use for these and would re-fetch them. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={image.name}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-words font-medium">{image.name}</span>
                      <Badge variant={image.kind === "LOGO" ? "secondary" : "default"}>
                        {KIND_LABEL[image.kind]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {image.width} × {image.height} · {formatBytes(image.bytes)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {image.usedBy.length > 0
                        ? `Used by ${image.usedBy.join(", ")}`
                        : "Not used by any lodge"}
                    </p>
                    <div className="mt-auto flex gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => startRename(image)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || image.usedBy.length > 0}
                        title={
                          image.usedBy.length > 0
                            ? "In use by a lodge — choose a different picture there first"
                            : undefined
                        }
                        onClick={() => void remove(image)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        dismissible={!busy}
        title="Rename picture"
        description="The name is only a label; it does not change the file."
        className="max-w-md"
      >
        {renameError ? (
          <p className="text-sm text-destructive" role="alert">
            {renameError}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="image-name">Name</Label>
          <Input
            id="image-name"
            value={renameValue}
            maxLength={IMAGE_NAME_MAX}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitRename();
              }
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void submitRename()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setRenaming(null)}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}
