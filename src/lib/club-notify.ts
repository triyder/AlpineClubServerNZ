import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit";
import { escapeHtml, recipients } from "@/lib/admin-digest";
import { loadMailSettings, mailConfigured, sendMail } from "@/lib/mail";
import { stripControlChars } from "@/lib/control-chars";

/**
 * Tell the administrators the moment a club registers, with a link to review
 * (approve or reject) it.
 *
 * Called only for a registration that CREATED a club: a repeat of an existing
 * code and a honeypot hit send nothing, so the registration rate limit is also
 * the limit on these mails. Never throws; the caller does not await it, and a
 * mail failure must never fail the registration. The digest still lists the
 * club afterwards whatever happens here.
 */

export type NewClubNotifyResult =
  | { sent: true; to: string[] }
  | { sent: false; reason: "missing" | "not-configured" | "no-recipient" | "failed" };

/**
 * The address the review link is built from: PUBLIC_BASE_URL and nothing else.
 *
 * NOT the request's Host or X-Forwarded-Host, which the registrant sends: a
 * registration could otherwise make this server mail its administrators a
 * review link to a look-alike site asking for their password. Without the
 * setting the mail goes out without a link.
 */
function reviewBaseUrl(): string | null {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function composeNewClubMail(
  club: {
    id: string;
    name: string;
    code: string;
    location: string | null;
    contactEmail: string;
    createdAt: Date;
    registrationNotes: string | null;
  },
  requestedLodges: string[],
  source: "web" | "api",
  baseUrl: string | null,
): { subject: string; text: string; html: string } {
  // Everything here was typed by an anonymous registrant: one line per field
  // (control characters stripped, so a name cannot add a line or a header), and
  // escaped in the HTML.
  const one = (s: string) => stripControlChars(s).trim();
  const name = one(club.name);
  const fields: [string, string][] = [
    ["Club", name],
    ["Code", one(club.code)],
    ["Location", club.location ? one(club.location) : "—"],
    ["Contact email", one(club.contactEmail)],
    ["Lodges requested", requestedLodges.length > 0 ? requestedLodges.map(one).join(", ") : "none"],
    ["Registered", `${club.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC, ${source === "web" ? "registration form" : "API"}`],
  ];
  // Notes may run to several lines; each is kept, each stripped.
  const notes = club.registrationNotes
    ? club.registrationNotes.split(/\r?\n/).map(one).filter((l) => l.length > 0)
    : [];
  const reviewUrl = baseUrl ? `${baseUrl}/clubs/review/${encodeURIComponent(club.id)}` : null;

  const subject = `New club connection awaiting approval: ${name}`;
  const text = [
    "A club has asked to connect to the Alpine Club server. It cannot use its key until it is approved.",
    "",
    ...fields.map(([k, v]) => `${k}: ${v}`),
    ...(notes.length > 0 ? ["Note:", ...notes.map((l) => `  ${l}`)] : []),
    "",
    reviewUrl
      ? `Approve or reject (sign-in required): ${reviewUrl}`
      : "Approve or reject it on the Connections page (/clubs).",
  ].join("\n");
  const html = [
    "<p>A club has asked to connect to the Alpine Club server. It cannot use its key until it is approved.</p>",
    `<table>${fields.map(([k, v]) => `<tr><th align="left">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>`,
    notes.length > 0 ? `<p><strong>Note:</strong><br>${notes.map(escapeHtml).join("<br>")}</p>` : "",
    reviewUrl
      ? `<p><a href="${escapeHtml(reviewUrl)}">Review and approve</a> (sign-in required)</p>`
      : "<p>Approve or reject it on the Connections page (/clubs).</p>",
  ].join("\n");
  return { subject, text, html };
}

export async function notifyNewClub(
  clubId: string,
  source: "web" | "api",
): Promise<NewClubNotifyResult> {
  try {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: {
        id: true,
        name: true,
        code: true,
        location: true,
        contactEmail: true,
        createdAt: true,
        registrationNotes: true,
        requestedLodgeIds: true,
      },
    });
    if (!club) return { sent: false, reason: "missing" };

    const settings = await loadMailSettings();
    if (!mailConfigured(settings)) {
      logger.warn({ clubId }, "new club mail: no SMTP server configured; nothing sent");
      return { sent: false, reason: "not-configured" };
    }
    const to = await recipients(settings.digestTo);
    if (to.length === 0) {
      logger.warn({ clubId }, "new club mail: no recipient; nothing sent");
      return { sent: false, reason: "no-recipient" };
    }

    const lodges =
      club.requestedLodgeIds.length === 0
        ? []
        : await prisma.otherLodge.findMany({
            where: { id: { in: club.requestedLodgeIds } },
            select: { name: true },
            orderBy: { name: "asc" },
          });

    const mail = composeNewClubMail(club, lodges.map((l) => l.name), source, reviewBaseUrl());
    await sendMail({ to: to.join(", "), subject: mail.subject, text: mail.text, html: mail.html });
    await recordAudit({ action: "club.notify", clubId, metadata: { to } });
    return { sent: true, to };
  } catch (err) {
    logger.error({ err, clubId }, "new club mail failed");
    return { sent: false, reason: "failed" };
  }
}
