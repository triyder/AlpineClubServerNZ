import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  normalizeOtherLodgeText,
  otherLodgeOrderBy,
  otherLodgeSelect,
  otherLodgeUploadSchema,
  serializeOtherLodgeForClient,
  type OtherLodgeUploadItem,
} from "@/lib/other-lodges";

function rateLimited(resetAt: number) {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": String(
          Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
        ),
      },
    },
  );
}

/**
 * GET /api/v1/other-lodges — PULL distribution.
 *
 * Returns every registry entry an admin has marked `distribute = true`, for a
 * connected club's local AlpineClubBookingsNZ install to ingest. Optional
 * `?since=<ISO>` returns only rows changed after that cursor for incremental
 * sync; the response `cursor` is the newest `updatedAt` seen.
 */
export async function GET(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  const rl = checkRateLimit(`lodges:${token.id}`);
  if (!rl.allowed) return rateLimited(rl.resetAt);

  if (!hasScope(token, "lodges:read") && !hasScope(token, "sync:read")) {
    return NextResponse.json(
      { error: "Token lacks lodges:read scope" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  let since: Date | undefined;
  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "Invalid `since` timestamp" },
        { status: 400 },
      );
    }
    since = parsed;
  }

  const lodges = await prisma.otherLodge.findMany({
    where: {
      distribute: true,
      ...(since ? { updatedAt: { gt: since } } : {}),
    },
    orderBy: otherLodgeOrderBy(),
    select: otherLodgeSelect,
  });

  const serialized = lodges.map(serializeOtherLodgeForClient);
  // Newest updatedAt across the returned set drives the next incremental pull.
  const cursor = serialized.reduce<string | null>(
    (max, l) => (max === null || l.updatedAt > max ? l.updatedAt : max),
    null,
  );

  await recordAudit({
    action: "otherLodge.pull",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: { returned: serialized.length, since: sinceParam ?? null },
  });

  return NextResponse.json({ lodges: serialized, cursor, count: serialized.length });
}

// Plain scalar fields common to create and update (no relation/atomic ops), so
// the same object works for both `create` and `update` data.
type OtherLodgeMutableFields = {
  location?: string | null;
  bookingOfficerName?: string | null;
  bookingOfficerEmail?: string | null;
  bookingOfficerPhone?: string | null;
  bedCapacity?: number | null;
};

// Build the create/update column data from a validated upload item. Blank text
// folds to null; `distribute` and `sourceClub` are never set from client input.
function itemData(item: OtherLodgeUploadItem): OtherLodgeMutableFields {
  const data: OtherLodgeMutableFields = {};
  if (item.location !== undefined)
    data.location = normalizeOtherLodgeText(item.location);
  if (item.bookingOfficerName !== undefined)
    data.bookingOfficerName = normalizeOtherLodgeText(item.bookingOfficerName);
  if (item.bookingOfficerEmail !== undefined)
    data.bookingOfficerEmail = normalizeOtherLodgeText(item.bookingOfficerEmail);
  if (item.bookingOfficerPhone !== undefined)
    data.bookingOfficerPhone = normalizeOtherLodgeText(item.bookingOfficerPhone);
  if (item.bedCapacity !== undefined) data.bedCapacity = item.bedCapacity ?? null;
  return data;
}

/**
 * POST /api/v1/other-lodges — UPLOAD from a connected club.
 *
 * A club pushes its "Other lodges" entries. Each is keyed by unique `name` and
 * OWNED by the uploading club:
 *   - new name           -> created (sourceClub = this club, distribute = false)
 *   - name owned by club  -> updated (contact/capacity fields only)
 *   - name owned by other -> skipped (a club can't clobber central or another
 *                            club's entry, nor flip its distribution marker)
 *
 * Uploads never set `distribute`; a central admin marks entries for
 * distribution afterwards, and marked rows flow back out via the PULL endpoint.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  const rl = checkRateLimit(`lodges:${token.id}`);
  if (!rl.allowed) return rateLimited(rl.resetAt);

  if (!hasScope(token, "lodges:write") && !hasScope(token, "sync:write")) {
    return NextResponse.json(
      { error: "Token lacks lodges:write scope" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = otherLodgeUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid upload payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const results: Array<{
    name: string;
    status: "created" | "updated" | "skipped";
    reason?: string;
  }> = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of parsed.data.lodges) {
    const name = item.name.trim();
    const existing = await prisma.otherLodge.findUnique({
      where: { name },
      select: { id: true, sourceClubId: true },
    });

    if (!existing) {
      try {
        await prisma.otherLodge.create({
          data: {
            name,
            ...itemData(item),
            sourceClubId: club.id,
            distribute: false,
          },
        });
        created++;
        results.push({ name, status: "created" });
      } catch (error) {
        // Concurrent create of the same name — treat as an ownership conflict.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          skipped++;
          results.push({ name, status: "skipped", reason: "conflict" });
        } else {
          throw error;
        }
      }
    } else if (existing.sourceClubId === club.id) {
      await prisma.otherLodge.update({
        where: { id: existing.id },
        data: itemData(item),
      });
      updated++;
      results.push({ name, status: "updated" });
    } else {
      skipped++;
      results.push({
        name,
        status: "skipped",
        reason: existing.sourceClubId === null ? "owned-centrally" : "owned-by-other-club",
      });
    }
  }

  await recordAudit({
    action: "otherLodge.upload",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: { created, updated, skipped, total: parsed.data.lodges.length },
  });

  return NextResponse.json({ created, updated, skipped, results });
}
