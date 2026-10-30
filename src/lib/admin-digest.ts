import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit";
import { loadMailSettings, mailConfigured, MailNotConfiguredError, sendMail } from "@/lib/mail";

/**
 * The administrator's digest (#34): what happened on this server since the
 * last digest — connection requests and registrations, keys issued or
 * revoked, sync issues opened — sent by the host's cron through
 * `POST /api/jobs/digest`.
 *
 * Three rules, each pinned by a test:
 *  - ONE digest per period, never a repeat. The watermark (`digest.last_sent_at`
 *    in `system_settings`) is the instant the last digest covered up to; it
 *    moves only when a digest was actually sent, so a failed send or an
 *    empty period leaves nothing uncovered and a cron that fires twice sends
 *    once. A single-flight claim (`job_claims`) stops two runs overlapping.
 *  - Nothing new, nothing sent.
 *  - Counts, names and titles, never secrets: no key, no password, no token
 *    appears in the mail.
 */

export const DIGEST_JOB = "digest.admin";
export const DIGEST_WATERMARK_KEY = "digest.last_sent_at";
/** A run never covers more than this when no watermark exists yet. */
const FIRST_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_CLAIM_AFTER_MS = 15 * 60 * 1000;

export interface DigestContent {
  since: Date;
  until: Date;
  registered: {
    name: string;
    code: string;
    location: string | null;
    contactEmail: string;
    status: string;
    requestedLodges: string[];
    createdAt: Date;
  }[];
  reviewed: { name: string; code: string; status: string; reviewedAt: Date }[];
  tokensIssued: { club: string; name: string; prefix: string; createdAt: Date }[];
  tokensRevoked: { club: string; name: string; prefix: string; revokedAt: Date }[];
  issuesOpened: { club: string; kind: string; firstSeenAt: Date; occurrences: number }[];
  issuesStillOpen: number;
}

export type DigestRunResult =
  | { ran: false; reason: "claimed" }
  | { ran: true; sent: false; reason: "nothing-new" | "not-configured" | "no-recipient"; since: Date; until: Date }
  | { ran: true; sent: true; to: string[]; since: Date; until: Date; counts: Record<string, number> };

export function digestCounts(d: DigestContent): Record<string, number> {
  return {
    registered: d.registered.length,
    reviewed: d.reviewed.length,
    tokensIssued: d.tokensIssued.length,
    tokensRevoked: d.tokensRevoked.length,
    issuesOpened: d.issuesOpened.length,
    issuesStillOpen: d.issuesStillOpen,
  };
}

export function digestIsEmpty(d: DigestContent): boolean {
  const c = digestCounts(d);
  return c.registered + c.reviewed + c.tokensIssued + c.tokensRevoked + c.issuesOpened === 0;
}

/** Everything that happened in (since, until]. Reads only; nothing here is a secret. */
export async function collectDigest(since: Date, until: Date): Promise<DigestContent> {
  const window = { gt: since, lte: until };
  const [registered, reviewed, tokensIssued, tokensRevoked, issuesOpened, issuesStillOpen] =
    await Promise.all([
      prisma.club.findMany({
        where: { createdAt: window },
        select: {
          name: true,
          code: true,
          location: true,
          contactEmail: true,
          status: true,
          requestedLodgeIds: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.club.findMany({
        where: { reviewedAt: window },
        select: { name: true, code: true, status: true, reviewedAt: true },
        orderBy: { reviewedAt: "asc" },
      }),
      prisma.apiToken.findMany({
        where: { createdAt: window },
        select: { name: true, tokenPrefix: true, createdAt: true, club: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.apiToken.findMany({
        where: { revokedAt: window },
        select: { name: true, tokenPrefix: true, revokedAt: true, club: { select: { name: true } } },
        orderBy: { revokedAt: "asc" },
      }),
      prisma.syncIssue.findMany({
        where: { firstSeenAt: window },
        select: { kind: true, firstSeenAt: true, occurrences: true, club: { select: { name: true } } },
        orderBy: { firstSeenAt: "asc" },
      }),
      prisma.syncIssue.count({ where: { status: "OPEN" } }),
    ]);
  // The requested lodges by name, in one query for the whole period.
  const requestedIds = [...new Set(registered.flatMap((c) => c.requestedLodgeIds))];
  const lodgeNames = new Map(
    requestedIds.length === 0
      ? []
      : (
          await prisma.otherLodge.findMany({
            where: { id: { in: requestedIds } },
            select: { id: true, name: true },
          })
        ).map((l) => [l.id, l.name]),
  );
  return {
    since,
    until,
    registered: registered.map(({ requestedLodgeIds, ...c }) => ({
      ...c,
      requestedLodges: requestedLodgeIds.map((id) => lodgeNames.get(id) ?? "(a lodge since removed)"),
    })),
    reviewed: reviewed.map((c) => ({ ...c, reviewedAt: c.reviewedAt as Date })),
    tokensIssued: tokensIssued.map((t) => ({
      club: t.club.name,
      name: t.name,
      prefix: t.tokenPrefix,
      createdAt: t.createdAt,
    })),
    tokensRevoked: tokensRevoked.map((t) => ({
      club: t.club.name,
      name: t.name,
      prefix: t.tokenPrefix,
      revokedAt: t.revokedAt as Date,
    })),
    issuesOpened: issuesOpened.map((i) => ({
      club: i.club.name,
      kind: i.kind,
      firstSeenAt: i.firstSeenAt,
      occurrences: i.occurrences,
    })),
    issuesStillOpen,
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** The mail: plain text first, and a plain HTML twin built from the same lines. */
export function composeDigest(d: DigestContent, baseUrl: string | null): { subject: string; text: string; html: string } {
  const c = digestCounts(d);
  const sections: { title: string; lines: string[] }[] = [];
  if (d.registered.length) {
    sections.push({
      title: `New clubs (${d.registered.length})`,
      lines: d.registered.map(
        (r) =>
          `${r.name} (${r.code})${r.location ? `, ${r.location}` : ""}, ${r.contactEmail} — registered ${stamp(r.createdAt)}, ${
            r.status === "PENDING" ? "awaiting review" : `now ${r.status.toLowerCase()}`
          }${r.requestedLodges.length > 0 ? `; lodges requested: ${r.requestedLodges.join(", ")}` : ""}`,
      ),
    });
  }
  if (d.reviewed.length) {
    sections.push({
      title: `Reviewed (${d.reviewed.length})`,
      lines: d.reviewed.map((r) => `${r.name} (${r.code}) — ${r.status.toLowerCase()} ${stamp(r.reviewedAt)}`),
    });
  }
  if (d.tokensIssued.length) {
    sections.push({
      title: `API keys issued (${d.tokensIssued.length})`,
      lines: d.tokensIssued.map((t) => `${t.club}: "${t.name}" (${t.prefix}…) ${stamp(t.createdAt)}`),
    });
  }
  if (d.tokensRevoked.length) {
    sections.push({
      title: `API keys revoked (${d.tokensRevoked.length})`,
      lines: d.tokensRevoked.map((t) => `${t.club}: "${t.name}" (${t.prefix}…) ${stamp(t.revokedAt)}`),
    });
  }
  if (d.issuesOpened.length) {
    sections.push({
      title: `Sync issues opened (${d.issuesOpened.length})`,
      lines: d.issuesOpened.map((i) => `${i.club}: ${i.kind} — first seen ${stamp(i.firstSeenAt)}, ${i.occurrences} occurrence${i.occurrences === 1 ? "" : "s"}`),
    });
  }
  const openLine = `Sync issues still open: ${d.issuesStillOpen}`;
  const subject = `Alpine Club server digest, ${day(d.until)}: ${c.registered} new club${c.registered === 1 ? "" : "s"}, ${c.issuesOpened} issue${c.issuesOpened === 1 ? "" : "s"} opened`;
  const header = `What happened on the Alpine Club server between ${stamp(d.since)} and ${stamp(d.until)}.`;
  const links = baseUrl
    ? `Connections: ${baseUrl}/clubs\nIssues: ${baseUrl}/issues`
    : "";
  const text = [
    header,
    "",
    ...sections.flatMap((s) => [s.title, ...s.lines.map((l) => `  - ${l}`), ""]),
    openLine,
    links ? "" : undefined,
    links || undefined,
  ].filter((l): l is string => l !== undefined).join("\n");
  const html = [
    `<p>${escapeHtml(header)}</p>`,
    ...sections.map((s) => `<h3>${escapeHtml(s.title)}</h3><ul>${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`),
    `<p>${escapeHtml(openLine)}</p>`,
    baseUrl
      ? `<p><a href="${escapeHtml(baseUrl)}/clubs">Connections</a> · <a href="${escapeHtml(baseUrl)}/issues">Issues</a></p>`
      : "",
  ].join("\n");
  return { subject, text, html };
}

async function readWatermark(): Promise<Date | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: DIGEST_WATERMARK_KEY } });
  if (!row) return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function writeWatermark(until: Date): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: DIGEST_WATERMARK_KEY },
    create: { key: DIGEST_WATERMARK_KEY, value: until.toISOString() },
    update: { value: until.toISOString() },
  });
}

/**
 * Who receives it: the address under Settings → Email, else every ADMIN user.
 * Also who is told the moment a club registers (`club-notify.ts`).
 */
export async function recipients(digestTo: string): Promise<string[]> {
  if (digestTo) return [digestTo];
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  return admins.map((a) => a.email);
}

async function withDigestClaim<T>(now: Date, fn: () => Promise<T>): Promise<T | null> {
  // The claim row exists from first use; the guarded update below is the claim.
  await prisma.jobClaim.upsert({
    where: { name: DIGEST_JOB },
    create: { name: DIGEST_JOB, startedAt: null },
    update: {},
  });
  const staleCutoff = new Date(now.getTime() - STALE_CLAIM_AFTER_MS);
  const claim = await prisma.jobClaim.updateMany({
    where: { name: DIGEST_JOB, OR: [{ startedAt: null }, { startedAt: { lt: staleCutoff } }] },
    data: { startedAt: now },
  });
  if (claim.count === 0) return null;
  try {
    return await fn();
  } finally {
    await prisma.jobClaim
      .update({ where: { name: DIGEST_JOB }, data: { startedAt: null } })
      .catch((err) => logger.error({ err }, "failed to release digest.admin claim"));
  }
}

/**
 * One run: claim, read the watermark, collect, send if there is anything,
 * advance the watermark only after a successful send.
 */
export async function runAdminDigest(input: { now?: Date; baseUrl?: string | null } = {}): Promise<DigestRunResult> {
  const now = input.now ?? new Date();
  const result = await withDigestClaim(now, async (): Promise<DigestRunResult> => {
    const watermark = await readWatermark();
    const since = watermark ?? new Date(now.getTime() - FIRST_RUN_WINDOW_MS);
    const digest = await collectDigest(since, now);
    if (digestIsEmpty(digest)) {
      return { ran: true, sent: false, reason: "nothing-new", since, until: now };
    }
    const settings = await loadMailSettings();
    if (!mailConfigured(settings)) {
      logger.warn("admin digest: no SMTP server configured; nothing sent");
      return { ran: true, sent: false, reason: "not-configured", since, until: now };
    }
    const to = await recipients(settings.digestTo);
    if (to.length === 0) {
      logger.warn("admin digest: no recipient; nothing sent");
      return { ran: true, sent: false, reason: "no-recipient", since, until: now };
    }
    const mail = composeDigest(digest, input.baseUrl ?? process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? null);
    try {
      await sendMail({ to: to.join(", "), subject: mail.subject, text: mail.text, html: mail.html });
    } catch (err) {
      if (err instanceof MailNotConfiguredError) {
        return { ran: true, sent: false, reason: "not-configured", since, until: now };
      }
      throw err; // the watermark stays where it was
    }
    await writeWatermark(now);
    const counts = digestCounts(digest);
    await recordAudit({
      action: "digest.sent",
      metadata: { to, since: since.toISOString(), until: now.toISOString(), counts },
    });
    return { ran: true, sent: true, to, since, until: now, counts };
  });
  return result ?? { ran: false, reason: "claimed" };
}
