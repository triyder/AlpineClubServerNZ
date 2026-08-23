import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { assertPublicDestination, PushTargetError } from "@/lib/push-targets";

/**
 * Pushing shared posts out to club installs (Communication Portal).
 *
 * PUSH IS THE FAST PATH, NOT THE GUARANTEE. Every club also pulls
 * `/api/v1/feed/sync` on its own schedule, so a club that is unreachable,
 * paused, or has never registered a push target still receives everything —
 * just later. That is what lets this queue give up after a bounded number of
 * attempts instead of retrying forever: abandoning a delivery costs latency,
 * never a post.
 */

/** Attempts before a delivery is abandoned to the polling backstop. */
export const MAX_DELIVERY_ATTEMPTS = 6;

/** Rows drained per pass, so one bad club cannot monopolise a cycle. */
const BATCH_SIZE = 50;

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Exponential backoff, in seconds, indexed by attempt number.
 *
 * Roughly a minute, then five, then half an hour, then two hours, then six.
 * Deliberately long at the tail: a club install being down for hours is an
 * ordinary event (a deploy, a reboot, a home connection), and hammering it
 * every minute helps nobody and looks like an attack from its side.
 */
const BACKOFF_SECONDS = [60, 300, 1_800, 7_200, 21_600, 43_200];

function backoffFor(attempts: number): number {
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];
}

/**
 * The signing key this server holds.
 *
 * Read at call time rather than module load so a missing key is a clear error
 * on the one path that needs it, instead of preventing the whole server from
 * starting.
 */
function signingKey(): string {
  const key = process.env.PUSH_SIGNING_KEY?.trim();
  if (!key || key.length < 32) {
    throw new Error(
      "PUSH_SIGNING_KEY must be set to at least 32 characters before posts can be pushed.",
    );
  }
  return key;
}

/**
 * A club's push secret, DERIVED rather than stored.
 *
 * Nothing per-club is kept at rest, so a database dump does not hand over the
 * ability to forge pushes to every club on the network. Bumping
 * `pushSecretVersion` rotates one club without touching any other.
 */
export function derivePushSecret(clubId: string, version: number): string {
  return createHmac("sha256", signingKey())
    .update(`${clubId}:${version}`)
    .digest("hex");
}

/**
 * The signature a club checks.
 *
 * Over the TIMESTAMP AND THE BODY TOGETHER, not the body alone: signing only
 * the body makes every delivery replayable forever by anyone who captured one.
 * The receiver rejects a timestamp outside its tolerance, which bounds that
 * window to the clock skew it allows.
 */
export function signPushBody(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

/** Constant-time compare, for a receiver verifying a signature. */
export function verifyPushSignature(
  secret: string,
  timestamp: string,
  body: string,
  candidate: string,
): boolean {
  const expected = signPushBody(secret, timestamp, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate ?? "", "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Queue one post for every club that should receive it.
 *
 * Excludes the ORIGIN club: it already has the post, and pushing it back would
 * arrive as a mirrored copy of something the club wrote itself.
 *
 * Idempotent through the (post, club, kind) unique index — `createMany` with
 * `skipDuplicates` means a re-share or a repeated withdrawal cannot queue a
 * second copy.
 */
export async function enqueuePostDeliveries(
  postId: string,
  kind: "CREATED" | "REMOVED",
): Promise<number> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, clubId: true },
  });
  if (!post) return 0;

  const recipients = await prisma.club.findMany({
    where: {
      id: { not: post.clubId },
      status: "APPROVED",
      pushEnabled: true,
      pushUrl: { not: null },
    },
    select: { id: true },
  });
  if (recipients.length === 0) return 0;

  const result = await prisma.postDelivery.createMany({
    data: recipients.map((club) => ({
      postId: post.id,
      clubId: club.id,
      kind,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export interface DeliverySweepResult {
  attempted: number;
  delivered: number;
  failed: number;
  abandoned: number;
}

/**
 * Deliver one queued row.
 *
 * The destination is re-resolved on every attempt, not merely at registration:
 * a hostname that resolved publicly last week can be repointed into the
 * network today, and this is the last check before the connection.
 */
async function deliverOne(deliveryId: string): Promise<
  "delivered" | "failed" | "abandoned"
> {
  const delivery = await prisma.postDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      kind: true,
      attempts: true,
      club: {
        select: { id: true, pushUrl: true, pushSecretVersion: true },
      },
      post: {
        select: { id: true, removedAt: true, hiddenAt: true },
      },
    },
  });
  if (!delivery || !delivery.club.pushUrl) return "abandoned";

  const attempts = delivery.attempts + 1;

  const fail = async (message: string) => {
    const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;
    await prisma.postDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        lastError: message.slice(0, 300),
        status: exhausted ? "ABANDONED" : "PENDING",
        nextAttemptAt: new Date(Date.now() + backoffFor(attempts) * 1000),
      },
    });
    return exhausted ? ("abandoned" as const) : ("failed" as const);
  };

  try {
    await assertPublicDestination(delivery.club.pushUrl);
  } catch (error) {
    return fail(
      error instanceof PushTargetError
        ? error.message
        : "The destination could not be resolved.",
    );
  }

  // The push carries the post's IDENTITY, not its content. The receiving club
  // then pulls that id through the ordinary authenticated feed, which means the
  // push cannot be used to inject a post that this server would not otherwise
  // serve, and a captured push body discloses nothing about what was written.
  const body = JSON.stringify({
    event: delivery.kind === "REMOVED" ? "post.removed" : "post.shared",
    postId: delivery.post.id,
    // Hidden posts are pushed as removals: a mirror should take down a post
    // this server has hidden, and telling it "removed" is the instruction it
    // already knows how to follow.
    withdrawn:
      delivery.kind === "REMOVED" ||
      Boolean(delivery.post.removedAt) ||
      Boolean(delivery.post.hiddenAt),
  });

  const timestamp = String(Date.now());
  const secret = derivePushSecret(
    delivery.club.id,
    delivery.club.pushSecretVersion,
  );

  let response: Response;
  try {
    response = await fetch(delivery.club.pushUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Acs-Timestamp": timestamp,
        "X-Acs-Signature": signPushBody(secret, timestamp, body),
        "X-Acs-Secret-Version": String(delivery.club.pushSecretVersion),
      },
      body,
      // Never follow a redirect: a 302 into the private network would walk
      // straight past the address check performed above.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "The club could not be reached.",
    );
  }

  if (response.status >= 300 && response.status < 400) {
    return fail("The club's push URL redirected, which is not followed.");
  }
  if (!response.ok) {
    return fail(`The club answered ${response.status}.`);
  }

  await prisma.postDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      status: "DELIVERED",
      deliveredAt: new Date(),
      lastError: null,
    },
  });
  return "delivered";
}

/** Drain one batch of eligible deliveries. */
export async function runPostDeliverySweep(
  now: Date = new Date(),
): Promise<DeliverySweepResult> {
  const due = await prisma.postDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });

  const result: DeliverySweepResult = {
    attempted: due.length,
    delivered: 0,
    failed: 0,
    abandoned: 0,
  };

  for (const row of due) {
    try {
      const outcome = await deliverOne(row.id);
      if (outcome === "delivered") result.delivered += 1;
      else if (outcome === "abandoned") result.abandoned += 1;
      else result.failed += 1;
    } catch (error) {
      // One malformed row must not stop the sweep: the rest of the queue is
      // other clubs' posts.
      result.failed += 1;
      logger.error({ deliveryId: row.id, err: error }, "Post delivery failed");
    }
  }

  return result;
}
