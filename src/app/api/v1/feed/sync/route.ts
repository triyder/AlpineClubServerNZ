import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { publicBaseUrl } from "@/lib/env";
import { loadPostSettings } from "@/lib/settings";
import {
  parseLimit,
  parseTimestamp,
  postSelect,
  serializePostForSync,
  SYNC_LIMIT_DEFAULT,
  SYNC_LIMIT_MAX,
} from "@/lib/posts";

/**
 * GET /api/v1/feed/sync — the mirroring cursor.
 *
 * A forward cursor over `updatedAt`, matching the contract
 * GET /api/v1/other-lodges?since= already uses, so the client's existing sync
 * code has a shape to copy.
 *
 * The reason this exists separately from /api/v1/feed: a feed of VISIBLE posts
 * can never drive a mirror. A hidden or removed post simply stops matching the
 * filter, so the mirror never hears about it and keeps serving it forever —
 * auto-hide would be visible here and inert at every club. This endpoint
 * therefore returns removals as first-class entries, carrying ids only.
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

  const rl = checkRateLimit(`posts:sync:${token.id}`);
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
    SYNC_LIMIT_DEFAULT,
    SYNC_LIMIT_MAX,
  );

  const since = parseTimestamp(url.searchParams.get("since"));
  if (since === null) {
    return NextResponse.json(
      { error: "Invalid `since` timestamp" },
      { status: 400 },
    );
  }
  const sinceId = url.searchParams.get("sinceId");

  const settings = await loadPostSettings();
  const tombstoneHorizon = new Date(
    Date.now() - settings.tombstoneHorizonDays * 24 * 60 * 60 * 1000,
  );

  // Full sync: visible posts only. A club joining the network has no mirror to
  // correct, so sending it a backlog of tombstones for posts it never held
  // would be pure noise.
  const isFullSync = since === undefined;

  const where: Prisma.PostWhereInput = isFullSync
    ? { hiddenAt: null, removedAt: null }
    : sinceId
      ? {
          OR: [
            { updatedAt: { gt: since } },
            { updatedAt: since, id: { gt: sinceId } },
          ],
        }
      : { updatedAt: { gt: since } };

  // take limit+1: the extra row is how `hasMore` is computed without a second
  // count query.
  const rows = await prisma.post.findMany({
    where,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: postSelect,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const baseUrl = publicBaseUrl(req);
  const changes = page.map((p) => serializePostForSync(p, baseUrl));

  const last = page.at(-1);
  const cursor = last
    ? { since: last.updatedAt.toISOString(), sinceId: last.id }
    : // An empty page leaves the client's cursor exactly where it was, so it
      // re-asks from the same point next pass rather than jumping to "now" and
      // skipping anything committed in between.
      null;

  // Stamped here and nowhere else. ApiToken.lastUsedAt moves on any
  // authenticated call, so it would report a club as caught up when all it did
  // was pull the lodge registry — which is precisely the wrong answer for
  // "has this club received the post I removed?".
  await prisma.club
    .update({
      where: { id: club.id },
      data: { lastCommsSyncAt: new Date() },
    })
    .catch(() => {
      // Best effort: a failed stamp costs takedown visibility, not the sync.
    });

  await recordAudit({
    action: "post.sync",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: {
      returned: changes.length,
      removals: changes.filter((c) => c.state === "removed").length,
      fullSync: isFullSync,
      hasMore,
    },
  });

  return NextResponse.json({
    changes,
    cursor,
    hasMore,
    // A client whose stored cursor predates this has missed removals it can
    // never catch up on, because the stubs carrying them have been pruned. It
    // must discard its mirror and full-resync rather than carry stale rows.
    tombstoneHorizon: tombstoneHorizon.toISOString(),
  });
}
