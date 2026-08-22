import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { postSelect, type PostRecord } from "@/lib/posts";

/**
 * Queries behind the moderation console. Kept out of the route handlers so the
 * page (a server component) and the JSON API can share them without one
 * fetching from the other.
 */

export type PostTab = "hidden" | "flagged" | "all";

export function parseTab(raw: string | null): PostTab {
  return raw === "flagged" || raw === "all" ? raw : "hidden";
}

export interface PostQuery {
  tab: PostTab;
  q?: string;
  clubId?: string;
  limit: number;
}

function whereForTab(query: PostQuery): Prisma.PostWhereInput {
  const search: Prisma.PostWhereInput = query.q
    ? {
        OR: [
          { content: { contains: query.q, mode: "insensitive" } },
          { authorName: { contains: query.q, mode: "insensitive" } },
        ],
      }
    : {};

  const club: Prisma.PostWhereInput = query.clubId
    ? { clubId: query.clubId }
    : {};

  switch (query.tab) {
    case "hidden":
      // The working queue: everything auto-hidden at the threshold lands here
      // awaiting a human. Removed posts are excluded — they are stubs with no
      // content, and nothing about them is actionable.
      return { hiddenAt: { not: null }, removedAt: null, ...search, ...club };
    case "flagged":
      // Reported but not yet hidden: early warning, so an admin can act before
      // the threshold does.
      return {
        hiddenAt: null,
        removedAt: null,
        reportCount: { gt: 0 },
        ...search,
        ...club,
      };
    case "all":
      return { removedAt: null, ...search, ...club };
  }
}

function orderForTab(query: PostQuery): Prisma.PostOrderByWithRelationInput[] {
  // The flagged queue is worked by severity; everything else by recency.
  return query.tab === "flagged"
    ? [{ reportCount: "desc" }, { createdAt: "desc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];
}

export interface ReportBreakdown {
  reason: string;
  count: number;
}

export interface ModeratedPost {
  post: PostRecord;
  /** Per-reason counts across open reports only. */
  breakdown: ReportBreakdown[];
  /** Clubs whose members filed the open reports, for context. */
  reportingClubs: { id: string; name: string; code: string }[];
  notes: { reason: string; details: string; clubCode: string }[];
}

export async function listPostsForAdmin(
  query: PostQuery,
): Promise<ModeratedPost[]> {
  const posts = await prisma.post.findMany({
    where: whereForTab(query),
    orderBy: orderForTab(query),
    take: query.limit,
    select: postSelect,
  });

  if (posts.length === 0) return [];

  // One query for every post's open reports rather than N per row.
  const reports = await prisma.postReport.findMany({
    where: {
      postId: { in: posts.map((p) => p.id) },
      dismissedAt: null,
    },
    select: {
      postId: true,
      reason: true,
      details: true,
      reporterClub: { select: { id: true, name: true, code: true } },
    },
  });

  const byPost = new Map<string, typeof reports>();
  for (const r of reports) {
    const list = byPost.get(r.postId) ?? [];
    list.push(r);
    byPost.set(r.postId, list);
  }

  return posts.map((post) => {
    const own = byPost.get(post.id) ?? [];

    const counts = new Map<string, number>();
    const clubs = new Map<string, { id: string; name: string; code: string }>();
    const notes: ModeratedPost["notes"] = [];

    for (const r of own) {
      counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
      clubs.set(r.reporterClub.id, r.reporterClub);
      if (r.details) {
        notes.push({
          reason: r.reason,
          details: r.details,
          clubCode: r.reporterClub.code,
        });
      }
    }

    return {
      post,
      breakdown: [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      reportingClubs: [...clubs.values()],
      notes,
    };
  });
}

/**
 * How many approved clubs have pulled the sync feed since a given moment, and
 * which have not.
 *
 * This is what turns "I removed it" into "it is actually gone": removing a post
 * only publishes a signal, and each club acts on it at its next sync. Counted
 * from `Club.lastCommsSyncAt`, which only the sync endpoint stamps — using
 * `ApiToken.lastUsedAt` would count a club that merely pulled the lodge
 * registry and overstate convergence.
 */
export async function syncConvergence(since: Date) {
  const clubs = await prisma.club.findMany({
    where: { status: "APPROVED" },
    select: { id: true, name: true, code: true, lastCommsSyncAt: true },
    orderBy: { name: "asc" },
  });

  const synced = clubs.filter(
    (c) => c.lastCommsSyncAt !== null && c.lastCommsSyncAt >= since,
  );
  const pending = clubs.filter(
    (c) => c.lastCommsSyncAt === null || c.lastCommsSyncAt < since,
  );

  return { total: clubs.length, synced: synced.length, pending };
}

/**
 * Dismiss every open report on a post and reset the cached count.
 *
 * Stamping `dismissedAt` rather than deleting keeps the history visible to the
 * next admin, and — because the unique constraint is on (post, club, member) —
 * leaves the post genuinely re-reportable by a fresh set of members. Zeroing a
 * counter while the rows stayed would do neither.
 */
export async function dismissReports(postId: string): Promise<number> {
  const [dismissed] = await prisma.$transaction([
    prisma.postReport.updateMany({
      where: { postId, dismissedAt: null },
      data: { dismissedAt: new Date() },
    }),
    prisma.post.update({ where: { id: postId }, data: { reportCount: 0 } }),
  ]);
  return dismissed.count;
}
