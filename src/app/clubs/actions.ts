"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";

async function setStatus(
  clubId: string,
  status: "APPROVED" | "REJECTED",
): Promise<void> {
  const session = await requireManager();

  // Only PENDING clubs are transitionable, so a double-submit or a stale form
  // cannot flip an already-decided club.
  const updated = await prisma.club.updateMany({
    where: { id: clubId, status: "PENDING" },
    data: {
      status,
      reviewedById: session.userId,
      reviewedAt: new Date(),
    },
  });

  if (updated.count > 0) {
    await recordAudit({
      action: status === "APPROVED" ? "club.approve" : "club.reject",
      clubId,
      metadata: { reviewerId: session.userId },
    });
  }

  revalidatePath("/clubs");
  revalidatePath("/dashboard");
}

export async function approveClubAction(formData: FormData): Promise<void> {
  await setStatus(String(formData.get("clubId")), "APPROVED");
}

export async function rejectClubAction(formData: FormData): Promise<void> {
  await setStatus(String(formData.get("clubId")), "REJECTED");
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  await requireManager();
  const tokenId = String(formData.get("tokenId"));
  const updated = await prisma.apiToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count > 0) {
    await recordAudit({ action: "token.revoke", tokenId });
  }
  revalidatePath("/clubs");
}

/**
 * Delete a REVOKED key's row (#31). A live key is never deletable: it is
 * revoked first, and the delete's own WHERE refuses anything not revoked, so
 * a stale or doctored form cannot remove a key that is still in use. The
 * audit entry keeps the key's identity in its metadata, because the token
 * row it would point at is gone (the FK nulls on delete).
 */
export async function deleteRevokedTokenAction(formData: FormData): Promise<void> {
  const session = await requireManager();
  const tokenId = String(formData.get("tokenId"));
  const token = await prisma.apiToken.findUnique({
    where: { id: tokenId },
    select: { id: true, clubId: true, name: true, tokenPrefix: true, revokedAt: true },
  });
  if (token?.revokedAt) {
    const deleted = await prisma.apiToken.deleteMany({
      where: { id: token.id, revokedAt: { not: null } },
    });
    if (deleted.count > 0) {
      await recordAudit({
        action: "token.delete",
        clubId: token.clubId,
        userId: session.userId,
        metadata: {
          tokenId: token.id,
          name: token.name,
          prefix: token.tokenPrefix,
          revokedAt: token.revokedAt.toISOString(),
        },
      });
    }
  }
  revalidatePath("/clubs");
}
