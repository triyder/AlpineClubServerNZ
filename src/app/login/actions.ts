"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-next-path";

export interface LoginState {
  error?: string;
}

/** Sign-in attempts allowed per window, per caller address and per account. */
const LOGIN_PER_IP = 20;
const LOGIN_PER_EMAIL = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

let dummy: Promise<string> | null = null;

/** A real bcrypt hash of a random secret, made once per process. */
function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("hex"));
  return dummy;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  // Password guessing is limited per caller address AND per account, before
  // any hash is computed: the address alone lets a botnet try one account
  // forever, the account alone lets one caller lock out every admin it knows.
  const headerList = await headers();
  const ip = clientIpFromHeaders(headerList) ?? "unknown";
  const now = Date.now();
  const byIp = checkRateLimit(`login:ip:${ip}`, now, LOGIN_PER_IP, LOGIN_WINDOW_MS);
  const byEmail = checkRateLimit(`login:email:${parsed.data.email}`, now, LOGIN_PER_EMAIL, LOGIN_WINDOW_MS);
  if (!byIp.allowed || !byEmail.allowed) {
    await recordAudit({
      action: "auth.login",
      outcome: "FAILURE",
      ipAddress: ip,
      userAgent: headerList.get("user-agent"),
      metadata: { email: parsed.data.email, reason: "rate_limited" },
    });
    return { error: "Too many sign-in attempts. Wait 15 minutes and try again." };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  // Verify against a real (or dummy) hash either way to avoid leaking whether
  // the email exists via response timing. The dummy must be a WELL-FORMED
  // bcrypt hash of the same cost: bcrypt rejects a malformed one instantly,
  // which answers an unknown email ~250 ms sooner than a known one.
  const hash = user?.passwordHash ?? (await dummyHash());
  const ok = await verifyPassword(parsed.data.password, hash);

  if (!user || !ok) {
    await recordAudit({
      action: "auth.login",
      outcome: "FAILURE",
      ipAddress: ip,
      userAgent: headerList.get("user-agent"),
      metadata: { email: parsed.data.email },
    });
    return { error: "Invalid email or password." };
  }

  await createSession({ userId: user.id, email: user.email, role: user.role });
  await recordAudit({
    action: "auth.login",
    outcome: "SUCCESS",
    metadata: { userId: user.id },
  });

  redirect(safeNextPath(formData.get("next")) ?? "/dashboard");
}
