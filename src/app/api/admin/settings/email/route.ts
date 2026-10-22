import { NextResponse } from "next/server";
import { guardAdminSession, guardAdminWrite } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import {
  loadMailSettings,
  mailSettingsInputSchema,
  MailSettingsError,
  saveMailSettings,
} from "@/lib/mail";

/**
 * GET|PUT /api/admin/settings/email — the SMTP settings (#33).
 *
 * ADMIN only. The password is accepted on PUT and never returned: GET and the
 * PUT response carry `passwordSet` instead. The audit entry records what
 * changed apart from the password, and only that a password was replaced.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await guardAdminSession("admin");
  if (!guard.ok) return guard.response;
  return NextResponse.json({ settings: await loadMailSettings() });
}

export async function PUT(req: Request) {
  const guard = await guardAdminWrite(req, "admin");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const body = await req.json().catch(() => null);
  const parsed = mailSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid email settings", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const before = await loadMailSettings();
  let after;
  try {
    after = await saveMailSettings(parsed.data);
  } catch (err) {
    if (err instanceof MailSettingsError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }

  const { passwordSet: _b, ...beforeRest } = before;
  const { passwordSet: _a, ...afterRest } = after;
  await recordAudit({
    action: "settings.email.update",
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: {
      before: beforeRest,
      after: afterRest,
      passwordReplaced: Boolean(parsed.data.password),
    },
  });

  return NextResponse.json({ settings: after });
}
