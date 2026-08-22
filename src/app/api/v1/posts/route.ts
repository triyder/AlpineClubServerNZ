import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { publicBaseUrl } from "@/lib/env";
import {
  normalizePostContent,
  POST_CONTENT_MAX,
  sharePostSchema,
} from "@/lib/posts";
import {
  assertBatchWithinLimits,
  deleteStoredImage,
  ImageRejectedError,
  MAX_IMAGES,
  writeProcessedImage,
  type StoredImage,
} from "@/lib/uploads";

/**
 * POST /api/v1/posts — a club shares one of its posts with the network.
 *
 * Only ever called when a member ticked "share with all clubs" in their local
 * AlpineClubBookingsNZ install. Club-local posts never reach this server, which
 * is why there is no `scope` field to choose.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Far tighter than the global 120/min: each share holds its images in memory
// while sharp works, so this limit — not the byte cap — is the real defence
// against a client exhausting the container.
const SHARE_RATE_MAX = 10;
const SHARE_RATE_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  const rl = checkRateLimit(
    `posts:share:${token.id}`,
    Date.now(),
    SHARE_RATE_MAX,
    SHARE_RATE_WINDOW_MS,
  );
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const parsed = sharePostSchema.safeParse({
    author_user_id: form.get("author_user_id"),
    author_name: form.get("author_name"),
    author_email: form.get("author_email"),
    content: form.get("content"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid post payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Normalise before the length check so a body padded with control characters
  // cannot slip past a limit it only meets before stripping.
  const content = normalizePostContent(parsed.data.content);
  if (content.length === 0) {
    return NextResponse.json(
      { error: "Post content is empty" },
      { status: 400 },
    );
  }
  if (content.length > POST_CONTENT_MAX) {
    return NextResponse.json(
      { error: `Post content exceeds ${POST_CONTENT_MAX} characters` },
      { status: 400 },
    );
  }

  const files = form
    .getAll("images")
    .filter((v): v is File => v instanceof File && v.size > 0);

  // Count and combined size first, before a single byte is decoded.
  try {
    assertBatchWithinLimits(files.map((f) => f.size));
  } catch (err) {
    if (err instanceof ImageRejectedError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    throw err;
  }

  // Files are written before the row exists, so anything already on disk has to
  // be unlinked if a later image fails or the insert does. Without this a
  // rejected post would leave its images behind as untracked orphans.
  const stored: StoredImage[] = [];
  const rollback = async () => {
    await Promise.all(stored.map((s) => deleteStoredImage(s.storageKey)));
  };

  try {
    for (const file of files.slice(0, MAX_IMAGES)) {
      const buf = Buffer.from(await file.arrayBuffer());
      stored.push(await writeProcessedImage(buf));
    }
  } catch (err) {
    await rollback();
    if (err instanceof ImageRejectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let postId: string;
  try {
    const post = await prisma.post.create({
      data: {
        // From the token, never from the body: a club may only post as itself.
        clubId: club.id,
        authorUserId: parsed.data.author_user_id,
        authorName: parsed.data.author_name,
        authorEmail: parsed.data.author_email ?? null,
        content,
        images: {
          create: stored.map((s, index) => ({
            publicId: s.publicId,
            storageKey: s.storageKey,
            width: s.width,
            height: s.height,
            bytes: s.bytes,
            position: index,
          })),
        },
      },
      select: { id: true },
    });
    postId = post.id;
  } catch (err) {
    await rollback();
    throw err;
  }

  await recordAudit({
    action: "post.share",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: { postId, images: stored.length, contentLength: content.length },
  });

  // The id is how the club un-shares later, so it is the one thing the response
  // must carry. Mirrors pick the post up on their next /feed/sync pass.
  return NextResponse.json(
    { id: postId, images: stored.length, baseUrl: publicBaseUrl(req) },
    { status: 201 },
  );
}
