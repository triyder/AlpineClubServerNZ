import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { publicBaseUrl } from "@/lib/env";
import {
  FEED_LIMIT_DEFAULT,
  FEED_LIMIT_MAX,
  parseLimit,
  parseTimestamp,
  postSelect,
  serializePostForClient,
} from "@/lib/posts";

/**
 * GET /api/v1/feed — browse visible network posts, newest first.
 *
 * For a client that renders live rather than mirroring. AlpineClubBookingsNZ
 * does NOT use this: it mirrors through /api/v1/feed/sync, which also carries
 * removals. This endpoint is kept for simpler clients and for debugging.
 *
 * There is no scope filtering. Every post here is one a club chose to share
 * with the whole network; club-only posts never reach this server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  const rl = checkRateLimit(`posts:feed:${token.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(0, Math.ceil((rl.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  if (!hasScope(token, "posts:read")) {
    return NextResponse.json(
      { error: "Token lacks posts:read scope" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const limit = parseLimit(
    url.searchParams.get("limit"),
    FEED_LIMIT_DEFAULT,
    FEED_LIMIT_MAX,
  );

  const before = parseTimestamp(url.searchParams.get("before"));
  if (before === null) {
    return NextResponse.json(
      { error: "Invalid `before` timestamp" },
      { status: 400 },
    );
  }
  const beforeId = url.searchParams.get("beforeId");

  // Keyset on the composite (createdAt, id), not createdAt alone. Two posts
  // created in the same millisecond straddling a page boundary would otherwise
  // be silently skipped, and at cuid speed that is not a rare case.
  if (before && !beforeId) {
    return NextResponse.json(
      { error: "`beforeId` is required when `before` is given" },
      { status: 400 },
    );
  }

  const cursorFilter: Prisma.PostWhereInput | undefined =
    before && beforeId
      ? {
          OR: [
            { createdAt: { lt: before } },
            { createdAt: before, id: { lt: beforeId } },
          ],
        }
      : undefined;

  const posts = await prisma.post.findMany({
    where: {
      hiddenAt: null,
      removedAt: null,
      ...(cursorFilter ?? {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: postSelect,
  });

  const baseUrl = publicBaseUrl(req);
  const serialized = posts.map((p) => serializePostForClient(p, baseUrl));

  // Null on the last page, so a client knows to stop rather than re-requesting
  // the same tail forever.
  const last = posts.at(-1);
  const cursor =
    posts.length === limit && last
      ? { before: last.createdAt.toISOString(), beforeId: last.id }
      : null;

  await recordAudit({
    action: "post.feed",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: { returned: serialized.length, paged: Boolean(before) },
  });

  return NextResponse.json({
    posts: serialized,
    cursor,
    count: serialized.length,
  });
}
