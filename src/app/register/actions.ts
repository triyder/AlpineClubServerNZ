"use server";

import { clubRegisterSchema } from "@/lib/validation";
import { registerClub } from "@/lib/clubs";
import { recordAudit } from "@/lib/audit";
import { issueClubToken } from "@/lib/issue-club-token";

export interface RegisterState {
  error?: string;
  success?: boolean;
  /** False when the code already belonged to a club: nothing was created. */
  created?: boolean;
  /**
   * The club's first API key, present ONLY on the response that created the
   * club (#30). It is held in the page's action state and shown once; the
   * server stores its hash and never returns it again. It works once an
   * administrator approves the club (`authenticateApiRequest`).
   */
  apiKey?: string;
  keyPrefix?: string;
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

  // A key is minted ONLY for the club this submission created. A code that
  // already belongs to a club gets the pending-review answer and no key, so
  // knowing a club's code never mints a key for it; keys for an existing club
  // come from its administrator on the Connections page.
  if (!result.created) {
    return { success: true, created: false };
  }
  const issued = await issueClubToken({ clubId: result.club.id, source: "register" });
  return {
    success: true,
    created: true,
    apiKey: issued.plaintext,
    keyPrefix: issued.prefix,
  };
}
