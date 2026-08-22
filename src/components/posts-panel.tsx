"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type Tab = "hidden" | "flagged" | "all";

export interface AdminPostRow {
  id: string;
  club: { id: string; name: string; code: string };
  authorName: string;
  authorUserId: string;
  authorEmail: string | null;
  content: string;
  images: { id: string; url: string; width: number; height: number }[];
  createdAt: string;
  reportCount: number;
  hiddenAt: string | null;
  hiddenBy: "SYSTEM" | "ADMIN" | null;
  autoHideExempt: boolean;
  breakdown: { reason: string; count: number }[];
  reportingClubs: { id: string; name: string; code: string }[];
  notes: { reason: string; details: string; clubCode: string }[];
  convergence: { total: number; synced: number; pending: string[] } | null;
}

const TABS: { key: Tab; label: string; hint: string }[] = [
  {
    key: "hidden",
    label: "Hidden",
    hint: "Auto-hidden at the report threshold, or hidden by an admin. Each one is waiting on a decision.",
  },
  {
    key: "flagged",
    label: "Flagged",
    hint: "Reported but still visible. Early warning, before the threshold acts.",
  },
  { key: "all", label: "All posts", hint: "Every network post, newest first." },
];

const REASON_LABEL: Record<string, string> = {
  SPAM: "Spam",
  INAPPROPRIATE: "Inappropriate",
  HARASSMENT: "Harassment",
  OTHER: "Other",
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function href(tab: Tab, query: string): string {
  const params = new URLSearchParams({ tab });
  if (query.trim()) params.set("q", query.trim());
  return `/posts?${params}`;
}

/**
 * Rows arrive from the server component; this handles the moderation actions
 * and asks the server to re-render afterwards. Tab and search are plain
 * navigations, so there is no client-side fetching on mount at all.
 */
export function PostsPanel({
  posts,
  tab,
  query,
}: {
  posts: AdminPostRow[];
  tab: Tab;
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(
    id: string,
    label: string,
    request: () => Promise<Response>,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(`${id}:${label}`);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        throw new Error((await res.json()).error ?? "Request failed");
      }
      // Re-run the server component so the row reflects what actually landed,
      // rather than patching local state and hoping the two agree.
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${label}`);
    } finally {
      setBusy(null);
    }
  }

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            asChild
            variant={t.key === tab ? "default" : "outline"}
          >
            <Link href={href(t.key, query)}>{t.label}</Link>
          </Button>
        ))}
        <form className="ml-auto flex gap-2" action="/posts" method="get">
          <input type="hidden" name="tab" value={tab} />
          <Input
            name="q"
            placeholder="Search content or author"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Button size="sm" variant="outline" type="submit">
            Search
          </Button>
        </form>
      </div>

      <p className="text-sm text-muted-foreground">{active.hint}</p>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {posts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {tab === "hidden"
              ? "Nothing is hidden. The queue is clear."
              : tab === "flagged"
                ? "No open reports."
                : "No posts have been shared with the network yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((row) => {
            const isBusy = busy?.startsWith(`${row.id}:`) || pending;
            return (
              <Card key={row.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{row.authorName}</span>
                    <Badge variant="outline">{row.club.code}</Badge>
                    <span className="text-muted-foreground">
                      {timeAgo(row.createdAt)}
                    </span>

                    {/* SYSTEM and ADMIN hides are distinguished on purpose:
                        only the former is asking for a decision. */}
                    {row.hiddenBy === "SYSTEM" && (
                      <Badge variant="warning">Auto-hidden</Badge>
                    )}
                    {row.hiddenBy === "ADMIN" && (
                      <Badge variant="secondary">Hidden by admin</Badge>
                    )}
                    {row.autoHideExempt && (
                      <Badge variant="outline">Exempt from auto-hide</Badge>
                    )}
                    {row.reportCount > 0 && (
                      <Badge variant="destructive">
                        {row.reportCount} report
                        {row.reportCount === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>

                  <p className="whitespace-pre-wrap text-sm">{row.content}</p>

                  {row.images.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {row.images.map((img) => (
                        <div key={img.id} className="space-y-1">
                          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, not the Next image optimiser */}
                          <img
                            src={img.url}
                            alt=""
                            className="h-24 w-auto rounded border border-border"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() =>
                              act(
                                row.id,
                                "delete image",
                                () =>
                                  fetch(
                                    `/api/admin/posts/${row.id}/images/${img.id}`,
                                    { method: "DELETE" },
                                  ),
                                "Delete this image? The file is removed from disk immediately and cannot be recovered.",
                              )
                            }
                          >
                            Delete image
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {row.breakdown.length > 0 && (
                    <div className="space-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                      <div className="flex flex-wrap gap-2">
                        {row.breakdown.map((b) => (
                          <span
                            key={b.reason}
                            className="text-muted-foreground"
                          >
                            {REASON_LABEL[b.reason] ?? b.reason}: {b.count}
                          </span>
                        ))}
                        <span className="text-muted-foreground">
                          · from{" "}
                          {row.reportingClubs.map((c) => c.code).join(", ")}
                        </span>
                      </div>
                      {row.notes.map((n, i) => (
                        <p key={i} className="text-muted-foreground">
                          <span className="font-medium">{n.clubCode}</span> (
                          {REASON_LABEL[n.reason] ?? n.reason}): {n.details}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {row.hiddenAt ? (
                      <>
                        <Button
                          size="sm"
                          disabled={isBusy}
                          onClick={() =>
                            act(row.id, "restore", () =>
                              fetch(`/api/admin/posts/${row.id}/unhide`, {
                                method: "POST",
                                headers: {
                                  "content-type": "application/json",
                                },
                                body: JSON.stringify({}),
                              }),
                            )
                          }
                        >
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() =>
                            act(
                              row.id,
                              "restore and exempt",
                              () =>
                                fetch(`/api/admin/posts/${row.id}/unhide`, {
                                  method: "POST",
                                  headers: {
                                    "content-type": "application/json",
                                  },
                                  body: JSON.stringify({ exempt: true }),
                                }),
                              "Restore this post and exempt it from auto-hiding?\n\nUse this when a post is being targeted — otherwise three fresh reports will hide it again.",
                            )
                          }
                        >
                          Restore &amp; exempt
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          act(row.id, "hide", () =>
                            fetch(`/api/admin/posts/${row.id}`, {
                              method: "PATCH",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ hidden: true }),
                            }),
                          )
                        }
                      >
                        Hide
                      </Button>
                    )}

                    {row.reportCount > 0 && !row.hiddenAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          act(row.id, "dismiss reports", () =>
                            fetch(`/api/admin/posts/${row.id}/dismiss`, {
                              method: "POST",
                            }),
                          )
                        }
                      >
                        Dismiss reports
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto text-destructive"
                      disabled={isBusy}
                      onClick={() =>
                        act(
                          row.id,
                          "remove",
                          () =>
                            fetch(`/api/admin/posts/${row.id}`, {
                              method: "DELETE",
                            }),
                          "Remove this post from the network?\n\nThe text is blanked and every image file is deleted from disk immediately. This cannot be undone.\n\nClubs stop showing it at their next sync.",
                        )
                      }
                    >
                      Remove from network
                    </Button>
                  </div>

                  {row.convergence && (
                    <p className="text-xs text-muted-foreground">
                      {/* Hiding only publishes a signal; each club acts on it
                          at its next sync. Until then it is still on screen
                          for that club's members. */}
                      {row.convergence.synced} of {row.convergence.total} club
                      {row.convergence.total === 1 ? "" : "s"} synced since this
                      was hidden
                      {row.convergence.pending.length > 0 &&
                        ` · still to pick it up: ${row.convergence.pending.join(", ")}`}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {row.club.name} · author {row.authorUserId}
                    {row.authorEmail ? ` · ${row.authorEmail}` : ""}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
