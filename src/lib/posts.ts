import { z } from "zod";
import type { Prisma } from "@prisma/client";

/**
 * Helpers for the Communication Portal — the cross-club message board.
 *
 * Two serialisers, deliberately. `serializePostForClient` is what leaves this
 * server; `serializePostForAdmin` is what the console sees. The split mirrors
 * `other-lodges.ts` and exists to make one rule structural rather than
 * remembered: `authorUserId` and `authorEmail` are held for moderation and MUST
 * NOT reach a client. The feed reaches every connected club, so serialising a
 * member's email there would hand every club the personal addresses of every
 * other club's members.
 */

export const postSelect = {
  id: true,
  clubId: true,
  club: { select: { id: true, name: true, code: true } },
  authorUserId: true,
  authorName: true,
  authorEmail: true,
  content: true,
  reportCount: true,
  hiddenAt: true,
  hiddenBy: true,
  autoHideExempt: true,
  removedAt: true,
  removedBy: true,
  createdAt: true,
  updatedAt: true,
  images: {
    select: {
      id: true,
      publicId: true,
      storageKey: true,
      width: true,
      height: true,
      bytes: true,
      position: true,
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.PostSelect;

export type PostRecord = Prisma.PostGetPayload<{ select: typeof postSelect }>;

// ---------------------------------------------------------------------------
// Client-facing shapes
// ---------------------------------------------------------------------------

export interface ClientPostImage {
  /** Absolute URL. Unguessable per image; see PostImage.publicId. */
  url: string;
  width: number;
  height: number;
}

export interface ClientPost {
  id: string;
  club: { id: string; name: string; code: string };
  authorName: string;
  content: string;
  images: ClientPostImage[];
  createdAt: string;
  updatedAt: string;
}

/** One entry in a `/api/v1/feed/sync` page. */
export type SyncChange =
  | { state: "visible"; post: ClientPost }
  | { state: "removed"; id: string; reason: "hidden" | "removed" };

/** Absolute URL for one stored image. */
export function postImageUrl(baseUrl: string, publicId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/images/posts/${publicId}.webp`;
}

/**
 * The payload that leaves this server. Note what is absent: `authorUserId` and
 * `authorEmail` never appear. The authoring club already holds both, and no
 * other club has any use for another club's member identifiers.
 */
export function serializePostForClient(
  post: PostRecord,
  baseUrl: string,
): ClientPost {
  return {
    id: post.id,
    club: { id: post.club.id, name: post.club.name, code: post.club.code },
    authorName: post.authorName,
    content: post.content,
    images: post.images.map((img) => ({
      url: postImageUrl(baseUrl, img.publicId),
      width: img.width,
      height: img.height,
    })),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/**
 * Map a post to its sync entry.
 *
 * A removed or hidden post yields ids only — no content, no author, no images.
 * A mirror needs to know which row to drop and nothing else, and shipping the
 * body of a post that was hidden for being abusive would defeat hiding it.
 */
export function serializePostForSync(
  post: PostRecord,
  baseUrl: string,
): SyncChange {
  if (post.removedAt) {
    return { state: "removed", id: post.id, reason: "removed" };
  }
  if (post.hiddenAt) {
    return { state: "removed", id: post.id, reason: "hidden" };
  }
  return { state: "visible", post: serializePostForClient(post, baseUrl) };
}

// ---------------------------------------------------------------------------
// Admin-facing shape — everything, including what clients never receive.
// ---------------------------------------------------------------------------

export interface AdminPost extends Omit<ClientPost, "images"> {
  authorUserId: string;
  authorEmail: string | null;
  reportCount: number;
  hiddenAt: string | null;
  hiddenBy: "SYSTEM" | "ADMIN" | null;
  autoHideExempt: boolean;
  removedAt: string | null;
  removedBy: "CLUB" | "ADMIN" | "RETENTION" | null;
  images: (ClientPostImage & { id: string })[];
}

export function serializePostForAdmin(
  post: PostRecord,
  baseUrl: string,
): AdminPost {
  return {
    ...serializePostForClient(post, baseUrl),
    authorUserId: post.authorUserId,
    authorEmail: post.authorEmail,
    reportCount: post.reportCount,
    hiddenAt: post.hiddenAt?.toISOString() ?? null,
    hiddenBy: post.hiddenBy,
    autoHideExempt: post.autoHideExempt,
    removedAt: post.removedAt?.toISOString() ?? null,
    removedBy: post.removedBy,
    images: post.images.map((img) => ({
      id: img.id,
      url: postImageUrl(baseUrl, img.publicId),
      width: img.width,
      height: img.height,
    })),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const POST_CONTENT_MAX = 4000;
export const POST_AUTHOR_NAME_MAX = 200;
export const REPORT_DETAILS_MAX = 1000;

/**
 * Strip C0/C1 control characters and collapse runs of blank lines.
 *
 * Content is stored and rendered as PLAIN TEXT — React escapes it, so there is
 * no HTML sanitiser here and none is needed. The only real hazard would be
 * someone reaching for `dangerouslySetInnerHTML` downstream.
 */
export function normalizePostContent(raw: string): string {
  return (
    raw
      // Normalise line endings first so the strip below can remove every
      // remaining control character except tab and newline.
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Text fields of a share request. Images are validated separately in
 * `src/lib/uploads.ts` — they arrive as multipart parts, not JSON.
 *
 * There is no `scope` field: a post only reaches this server because a member
 * chose to share it with the network, so there is nothing left to choose.
 */
export const sharePostSchema = z.object({
  author_user_id: z.string().trim().min(1).max(200),
  author_name: z.string().trim().min(1).max(POST_AUTHOR_NAME_MAX),
  author_email: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(320).email().nullable().optional(),
    )
    .optional(),
  content: z.string().min(1).max(POST_CONTENT_MAX),
});
export type SharePostInput = z.infer<typeof sharePostSchema>;

export const reportPostSchema = z
  .object({
    reporter_user_id: z.string().trim().min(1).max(200),
    reason: z.enum(["SPAM", "INAPPROPRIATE", "HARASSMENT", "OTHER"]),
    details: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(REPORT_DETAILS_MAX).nullable().optional(),
      )
      .optional(),
  })
  .strict();
export type ReportPostInput = z.infer<typeof reportPostSchema>;

export const FEED_LIMIT_DEFAULT = 20;
export const FEED_LIMIT_MAX = 50;
export const SYNC_LIMIT_DEFAULT = 100;
export const SYNC_LIMIT_MAX = 200;

/** Clamp a `limit` query param into range, defaulting anything unparseable. */
export function parseLimit(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/** Parse an ISO timestamp query param. Returns undefined when absent. */
export function parseTimestamp(raw: string | null): Date | undefined | null {
  if (raw === null) return undefined;
  const parsed = new Date(raw);
  // null signals "present but invalid", which callers turn into a 400 — an
  // unparseable cursor must not be silently treated as "sync from the start".
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
