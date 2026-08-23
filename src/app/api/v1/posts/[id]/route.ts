import { NextResponse } from "next/server";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { removePost } from "@/lib/post-removal";

/**
 * DELETE /api/v1/posts/:id — the authoring club withdraws its own post from the
 * network.
 *
 * Covers both cases the club UI offers: deleting the post outright, and
 * un-sharing it while keeping the local copy. This server cannot tell them
 * apart and does not need to — either way the network copy goes.
 *
 * Members cannot reach this. The club's own admin can, for their club's posts
 * only; a central admin uses the console instead.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  const rl = checkRateLimit(`posts:delete:${token.id}`);
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

  if (!hasScope(token, "posts:write")) {
    return NextResponse.json(
      { error: "Token lacks posts:write scope" },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  }

  // expectClubId is what makes this own-club only. A post belonging to another
  // club yields null, exactly as a non-existent id does, so the response is 404
  // either way: a club must not be able to probe which ids belong to others.
  const result = await removePost(id, "CLUB", { expectClubId: club.id });

  if (result === null) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  await recordAudit({
    action: "post.unshare",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: {
      postId: id,
      alreadyRemoved: !result.removed,
      imagesDeleted: result.imagesDeleted,
    },
  });

  // 200 rather than 404 when it was already removed: the client retries this
  // after a network timeout, and a retry that reports failure would send an
  // admin hunting for a post that is in fact gone.
  return NextResponse.json({
    status: result.removed ? "removed" : "already-removed",
  });
}
