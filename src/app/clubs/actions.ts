"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { assignRequestedLodgesOnApproval, type RequestedLodgesOutcome } from "@/lib/club-lodges";

/**
 * The status moves the console offers, each from exactly one status:
 *  - PENDING   -> APPROVED or REJECTED (the review);
 *  - APPROVED  -> SUSPENDED (Unapprove: the club stops sending and receiving);
 *  - SUSPENDED -> APPROVED (Re-approve).
 */
const MOVES = {
  approve: { from: "PENDING", to: "APPROVED", audit: "club.approve" },
  reject: { from: "PENDING", to: "REJECTED", audit: "club.reject" },
  suspend: { from: "APPROVED", to: "SUSPENDED", audit: "club.suspend" },
  reapprove: { from: "SUSPENDED", to: "APPROVED", audit: "club.reapprove" },
} as const;

type StatusMove = (typeof MOVES)[keyof typeof MOVES];

async function setStatus(clubId: string, move: StatusMove): Promise<void> {
  const session = await requireManager();

  // The move is guarded by the status it starts from, in the WHERE itself, so
  // a double-submit or a stale form (an approve link opened twice, a suspend
  // pressed on a page loaded before someone else's) cannot flip a club twice.
  const updated = await prisma.club.updateMany({
    where: { id: clubId, status: move.from },
    data: {
      status: move.to,
      reviewedById: session.userId,
      reviewedAt: new Date(),
    },
  });

  if (updated.count > 0) {
    // #40: the FIRST approval assigns the lodges the club asked for at
    // registration, skipping (and recording) any taken in the meantime. A
    // re-approval does not: a suspended club kept its lodges, and re-running
    // the request could claim one an administrator has since moved.
    let lodges: RequestedLodgesOutcome | null = null;
    if (move === MOVES.approve) {
      const club = await prisma.club.findUnique({
        where: { id: clubId },
        select: { requestedLodgeIds: true },
      });
      if (club && club.requestedLodgeIds.length > 0) {
        lodges = await assignRequestedLodgesOnApproval(clubId, club.requestedLodgeIds);
      }
    }
    await recordAudit({
      action: move.audit,
      clubId,
      metadata: {
        reviewerId: session.userId,
        ...(lodges ? { lodgesAssigned: lodges.assigned, lodgesSkipped: lodges.skipped } : {}),
      },
    });
  }

  revalidatePath("/clubs");
  revalidatePath("/dashboard");
}

export async function approveClubAction(formData: FormData): Promise<void> {
  await setStatus(String(formData.get("clubId")), MOVES.approve);
}

export async function rejectClubAction(formData: FormData): Promise<void> {
  await setStatus(String(formData.get("clubId")), MOVES.reject);
}

/**
 * The same review from the page a new-club email links to
 * (`/clubs/review/[id]`), which then shows the outcome. The club id is
 * re-encoded rather than trusted as a path.
 */
export async function approveFromReviewAction(formData: FormData): Promise<void> {
  const clubId = String(formData.get("clubId"));
  await setStatus(clubId, MOVES.approve);
  redirect(`/clubs/review/${encodeURIComponent(clubId)}`);
}

export async function rejectFromReviewAction(formData: FormData): Promise<void> {
  const clubId = String(formData.get("clubId"));
  await setStatus(clubId, MOVES.reject);
  redirect(`/clubs/review/${encodeURIComponent(clubId)}`);
}

/**
 * Unapprove: the club's key stops working at once (`authenticateApiRequest`
 * admits APPROVED only), nothing more is queued or delivered to it, and it is
 * not asked for free beds. Its lodges, keys and history are kept for a
 * re-approval.
 */
export async function suspendClubAction(formData: FormData): Promise<void> {
  await setStatus(String(formData.get("clubId")), MOVES.suspend);
}

export async function reapproveClubAction(formData: FormData): Promise<void> {
  await setStatus(String(formData.get("clubId")), MOVES.reapprove);
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
