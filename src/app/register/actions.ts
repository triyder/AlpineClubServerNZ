"use server";

import { clubRegisterSchema } from "@/lib/validation";
import { registerClub } from "@/lib/clubs";
import { recordAudit } from "@/lib/audit";

export interface RegisterState {
  error?: string;
  success?: boolean;
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = clubRegisterSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim(),
    location: String(formData.get("location") ?? "").trim() || undefined,
    contactEmail: String(formData.get("contactEmail") ?? "").trim(),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  const result = await registerClub(parsed.data);
  if (!result.ok) {
    return { error: result.error };
  }

  await recordAudit({
    action: "club.register",
    clubId: result.club.id,
    metadata: { code: result.club.code, created: result.created, source: "web" },
  });

  return { success: true };
}
