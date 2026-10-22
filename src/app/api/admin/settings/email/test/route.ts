import { NextResponse } from "next/server";
import { guardAdminWrite } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { MailNotConfiguredError, sendMail } from "@/lib/mail";
import { SecretBoxError } from "@/lib/secret-box";
import { logger } from "@/lib/logger";

/**
 * POST /api/admin/settings/email/test — send a test message (#33).
 *
 * ADMIN only, and the recipient is ALWAYS the signed-in administrator's own
 * address: the route takes no body, so an admin session can never turn this
 * into a relay to anyone else. A transport failure is reported in the
 * provider's own words, which is what the operator needs to fix the settings.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await guardAdminWrite(req, "admin");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  try {
    const { messageId } = await sendMail({
      to: session.email,
      subject: "AlpineClubServerNZ test message",
      text: `This is a test message from your Alpine Club server's Settings → Email page, sent to ${session.email}. If you are reading it, outbound mail works.`,
    });
    await recordAudit({
      action: "settings.email.test",
      userId: session.userId,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      metadata: { to: session.email, messageId },
    });
    return NextResponse.json({ ok: true, to: session.email });
  } catch (err) {
    if (err instanceof MailNotConfiguredError || err instanceof SecretBoxError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "The mail server refused the message.";
    logger.warn({ err, to: session.email }, "test message failed");
    await recordAudit({
      action: "settings.email.test",
      outcome: "FAILURE",
      userId: session.userId,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      metadata: { to: session.email, error: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
