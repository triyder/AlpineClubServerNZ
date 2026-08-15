"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

export interface LoginState {
  error?: string;
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

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });

  // Verify against a real (or dummy) hash either way to avoid leaking whether
  // the email exists via response timing.
  const hash =
    user?.passwordHash ??
    "$2a$12$C6UzMDM.H6dfI/f/IKcEeO0000000000000000000000000000000000";
  const ok = await verifyPassword(parsed.data.password, hash);

  if (!user || !ok) {
    await recordAudit({
      action: "auth.login",
      outcome: "FAILURE",
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

  redirect("/dashboard");
}
