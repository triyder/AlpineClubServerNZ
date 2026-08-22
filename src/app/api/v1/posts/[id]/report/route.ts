import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { loadPostSettings } from "@/lib/settings";
import { reportPostSchema } from "@/lib/posts";

/**
 * POST /api/v1/posts/:id/report — a member flags a network post.
 *
 * Only ever called for network posts. A report against a club's own local post
 * is handled entirely inside that club's AlpineClubBookingsNZ install and never
 * reaches this server.
 *
 * The reporting CLUB comes from the API token. The member id within that club
 * is club-asserted and unverifiable, which is why the auto-hide threshold is
 * treated as a queue signal rather than a verdict: reaching it hides the post
 * pending review, and an admin can override and exempt it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_RATE_MAX = 20;
const REPORT_RATE_WINDOW_MS = 60_000;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  // Tight, because the threshold is the whole control and a scripted flood is
  // the way to abuse it. Rate limiting does not make forged reports impossible,
  // it makes them slow and leaves them in the audit log.
  const rl = checkRateLimit(
    `posts:report:${token.id}`,
    Date.now(),
    REPORT_RATE_MAX,
    REPORT_RATE_WINDOW_MS,
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

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = reportPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid report payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const settings = await loadPostSettings();

  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { id, removedAt: null },
      select: { id: true, hiddenAt: true, autoHideExempt: true },
    });
    if (!post) return { status: "not-found" } as const;

    try {
      await tx.postReport.create({
        data: {
          postId: post.id,
          reporterClubId: club.id,
          reporterUserId: parsed.data.reporter_user_id,
          reason: parsed.data.reason,
          details: parsed.data.details ?? null,
        },
      });
    } catch (err) {
      // P2002 = this member already reported this post. Idempotent success:
      // return without recounting, so retrying a request whose response was
      // lost cannot nudge the post closer to the threshold.
      if (isUniqueViolation(err)) return { status: "duplicate" } as const;
      throw err;
    }

    // Recount from the rows rather than incrementing a counter. Dismissed
    // reports must stop counting, and a recount cannot drift away from the
    // rows it summarises the way a blind increment can after any partial
    // failure.
    const open = await tx.postReport.findMany({
      where: { postId: post.id, dismissedAt: null },
      select: { reporterClubId: true },
    });
    const distinctClubs = new Set(open.map((r) => r.reporterClubId)).size;

    const shouldHide =
      !post.hiddenAt &&
      // An admin reviewed this post and cleared it. Without this check,
      // unhiding a post someone is targeting just restarts the countdown and
      // it re-hides at the next three reports, indefinitely.
      !post.autoHideExempt &&
      open.length >= settings.autoHideThreshold &&
      distinctClubs >= settings.autoHideMinClubs;

    await tx.post.update({
      where: { id: post.id },
      data: {
        reportCount: open.length,
        ...(shouldHide
          ? { hiddenAt: new Date(), hiddenBy: "SYSTEM" as const }
          : {}),
      },
    });

    return {
      status: "recorded",
      hidden: shouldHide,
      openReports: open.length,
    } as const;
  });

  if (result.status === "not-found") {
    await recordAudit({
      action: "post.report",
      outcome: "FAILURE",
      clubId: club.id,
      tokenId: token.id,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
      metadata: { postId: id, reason: "not-found" },
    });
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  await recordAudit({
    action: "post.report",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: {
      postId: id,
      status: result.status,
      reason: parsed.data.reason,
      ...(result.status === "recorded"
        ? { hidden: result.hidden, openReports: result.openReports }
        : {}),
    },
  });

  // No push step. The update bumped `updatedAt`, so the next /feed/sync pass
  // from each club carries { state: "removed", reason: "hidden" }.
  return NextResponse.json({
    status: result.status,
    hidden: result.status === "recorded" ? result.hidden : false,
  });
}
