"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";

/**
 * Flag an issue as cleared.
 *
 * Status-guarded (`updateMany` where OPEN), so a double-submit or a stale form
 * cannot clear twice or overwrite who cleared it. `openKey` is nulled in the same
 * write: that frees the unique key, so if the same club mismatches again a NEW
 * issue opens rather than the cleared one being silently re-used.
 *
 * Issues are never cleared automatically — a club that has caught up still needs
 * a person to say "I have seen this".
 */
export async function clearIssueAction(formData: FormData): Promise<void> {
  const session = await requireManager();
  const issueId = String(formData.get("issueId") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!issueId) return;

  const cleared = await prisma.syncIssue.updateMany({
    where: { id: issueId, status: "OPEN" },
    data: {
      status: "CLEARED",
      openKey: null,
      clearedById: session.userId,
      clearedAt: new Date(),
      note: note || null,
    },
  });

  if (cleared.count > 0) {
    const issue = await prisma.syncIssue.findUnique({
      where: { id: issueId },
      select: { clubId: true, kind: true },
    });
    await recordAudit({
      action: "issue.cleared",
      clubId: issue?.clubId ?? null,
      userId: session.userId,
      metadata: { issueId, kind: issue?.kind ?? null },
    });
  }

  revalidatePath("/issues");
}
