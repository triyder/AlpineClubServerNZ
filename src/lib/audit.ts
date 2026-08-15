import "server-only";
import type { AuditOutcome, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface AuditEntry {
  action: string;
  outcome?: AuditOutcome;
  clubId?: string | null;
  tokenId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Persist an audit record for a client connection / request or a notable admin
 * action. Never throws: audit logging must not break the request it describes,
 * so failures are logged and swallowed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        outcome: entry.outcome ?? "SUCCESS",
        clubId: entry.clubId ?? null,
        tokenId: entry.tokenId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}
