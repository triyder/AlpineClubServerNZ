import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { changePasswordSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";

/**
 * POST /api/auth/change-password
 *
 * Authenticated (session cookie). Verifies the current password, enforces the
 * password policy on the new one, and rehashes with bcrypt. Mirrors the
 * AlpineClubBookingsNZ change-password flow, adapted to this server's User model.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    await recordAudit({
      action: "auth.password.change",
      outcome: "FAILURE",
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      metadata: { userId: session.userId, reason: "wrong_current_password" },
    });
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current password" },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      passwordChangedAt: new Date(),
    },
  });

  await recordAudit({
    action: "auth.password.change",
    outcome: "SUCCESS",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { userId: session.userId },
  });

  return NextResponse.json({ success: true });
}
