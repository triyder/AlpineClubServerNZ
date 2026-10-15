import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { seasonDatesProblem } from "@/lib/lodge-seasons";
import { enforceClientApiVersion } from "@/lib/api-version-gate";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  amenitiesDiffer,
  amenityCreateRows,
  buildOtherLodgePullEnvelope,
  lodgeDetailColumns,
  lodgeDetailDiffers,
  normalizeOtherLodgeText,
  liveOtherLodgeWhere,
  otherLodgeOrderBy,
  otherLodgePullCursor,
  otherLodgeSelect,
  seasonDatesAfter,
  otherLodgeUploadSchema,
  serializeOtherLodgeForClient,
  type LodgeDetailColumns,
  type OtherLodgeUploadItem,
} from "@/lib/other-lodges";
import { replaceAmenities } from "@/lib/other-lodge-amenities";

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
 * GET /api/v1/other-lodges — PULL.
 *
 * Returns every registry entry, for a
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

  // A club on a different API version transfers nothing (see api-version-gate).
  const versionRefusal = await enforceClientApiVersion(req, auth.client);
  if (versionRefusal) return versionRefusal;
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

  // The club's own lodges are read on EVERY pull, whatever `since` says: it is
  // the club's whole current list and not a delta (see the envelope builder).
  // A deleted lodge (#16) is never in `lodges` or the club's owned list; it is
  // reported in `deletedLodges` instead, on the same `since`: every deletion
  // newer than the club's cursor, or all of them on a pull without one, so a
  // club that was away still hides every lodge deleted meanwhile.
  const [lodges, owned, deleted] = await Promise.all([
    prisma.otherLodge.findMany({
      where: {
        ...liveOtherLodgeWhere,
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      orderBy: otherLodgeOrderBy(),
      select: otherLodgeSelect,
    }),
    prisma.otherLodge.findMany({
      where: { sourceClubId: club.id, ...liveOtherLodgeWhere },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.otherLodge.findMany({
      where: { deletedAt: since ? { gt: since } : { not: null } },
      orderBy: { deletedAt: "asc" },
      select: { id: true, deletedAt: true },
    }),
  ]);
  const deletedLodges = deleted.flatMap((d) =>
    d.deletedAt ? [{ id: d.id, deletedAt: d.deletedAt }] : [],
  );

  const serialized = lodges.map(serializeOtherLodgeForClient);
  // The newest instant across the returned lodges AND deletions drives the
  // next incremental pull (`otherLodgePullCursor`). A row or tombstone whose
  // transaction committed AFTER this query ran but was stamped BEFORE this
  // cursor would be missed by a strict `> cursor` pull; the booking site guards
  // against that by overlapping its next `since` by 60 seconds, and its merge
  // treats a re-sent row or deletion as a no-op.
  const cursor = otherLodgePullCursor(serialized, deletedLodges);

  await recordAudit({
    action: "otherLodge.pull",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: {
      returned: serialized.length,
      deletions: deletedLodges.length,
      since: sinceParam ?? null,
    },
  });

  return NextResponse.json(
    buildOtherLodgePullEnvelope({
      lodges: serialized,
      cursor,
      ownLodges: owned,
      deletedLodges,
    }),
  );
}

// Plain scalar fields common to create and update (no relation/atomic ops), so
// the same object works for both `create` and `update` data.
type OtherLodgeMutableFields = {
  location?: string | null;
  bookingOfficerName?: string | null;
  bookingOfficerEmail?: string | null;
  bookingOfficerPhone?: string | null;
  bedCapacity?: number | null;
} & LodgeDetailColumns;

// Build the create/update column data from a validated upload item. Blank text
// folds to null; `sourceClub` is never set from client input.
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
  Object.assign(data, lodgeDetailColumns(item));
  return data;
}

// True when the incoming data changes at least one stored column. Only the keys
// present in `data` are compared, so an omitted field never counts as a change.
// Lets the receiver skip a no-op write (and the `updatedAt` bump it would cause)
// when a club re-uploads an unchanged row — keeping distribution incremental.
function itemDiffers(
  data: OtherLodgeMutableFields,
  // The stored row as read: its rates are Decimals, not the written text.
  existing: Record<string, unknown>,
): boolean {
  // Shared with the detail fields: it compares dates by calendar day, which a
  // plain `!==` on two Date objects would not (every pair would look changed).
  return lodgeDetailDiffers(data, existing);
}

/**
 * POST /api/v1/other-lodges — UPLOAD from a connected club.
 *
 * A club pushes its "Other lodges" entries, each OWNED by the uploading club.
 * Names are not unique (#69, API 2.5): two lodges may share a name, and the
 * `id` is what tells them apart.
 *
 * An item that quotes the lodge's `id` (API 2.3) is matched BY THAT ID only:
 *   - id of a lodge the club owns -> updated (every field the item carries:
 *                            contact, capacity, the detail fields and the
 *                            amenity set), and RENAMED when `name` differs
 *   - id owned by other   -> skipped (a club can't clobber central or another
 *                            club's entry)
 *   - id not known        -> skipped (`unknown-id`), never created
 *
 * An item without an `id` (a lodge the club has not uploaded before, or a
 * pre-2.3 client) is matched against the club's OWN lodges of exactly that
 * name: exactly one live one -> that lodge, as if its id had been quoted
 * (never renamed). None live but one deleted -> skipped `deleted`. Several
 * live -> skipped `ambiguous-name` (the item must quote an id). None at all
 * -> CREATED, even when another club's lodge already has that name.
 *
 * A lodge an admin deleted (#16) is skipped as `deleted`: it is kept for the
 * bookings that cite it and never changed again. A rename moves `updatedAt`,
 * so every other club's next pull carries the new name under the same id.
 * Every result carries the lodge's `id` when there is one, so the club can
 * link a lodge it has just created without matching on its name.
 *
 * The whole payload is validated before anything is written, so a bad item
 * makes the whole upload a 400 with no partial effect. The per-item writes
 * are NOT one transaction; the audit row therefore carries the counts reached
 * even when a later item fails.
 *
 * Every stored entry then flows back out to every club via the PULL endpoint.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // A club on a different API version transfers nothing (see api-version-gate).
  const versionRefusal = await enforceClientApiVersion(req, auth.client);
  if (versionRefusal) return versionRefusal;
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
    // The lodge's id (API 2.5), whenever the item reached one.
    id?: string;
    name: string;
    status: "created" | "updated" | "unchanged" | "skipped";
    reason?: string;
  }> = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  // Of `updated`, how many changed the lodge's name (API 2.3).
  let renamed = 0;
  // Which lodges this upload created and renamed (#69): names may repeat, so
  // the audit row names them by id for an administrator to review.
  const createdLodges: Array<{ id: string; name: string }> = [];
  const renamedLodges: Array<{ id: string; from: string; to: string }> = [];

  // An item without an id (#69): the club's own lodge of exactly that name,
  // when there is just one live one. A deleted one is reported (so a
  // pre-2.3 client cannot resurrect it by name); several live ones cannot be
  // told apart and are reported too (`ambiguous`), so a retried item does not
  // add another copy each time. None at all is a create.
  const ownLodgeByName = async (name: string) => {
    const rows = await prisma.otherLodge.findMany({
      where: { name, sourceClubId: club.id },
      select: otherLodgeSelect,
      orderBy: { createdAt: "asc" },
    });
    const live = rows.filter((r) => !r.deletedAt);
    if (live.length > 1) return "ambiguous" as const;
    if (live.length === 1) return live[0];
    if (rows.length > 0) return rows[0];
    return null;
  };

  try {
    for (const item of parsed.data.lodges) {
      const name = item.name.trim();
      const existing = item.id
        ? await prisma.otherLodge.findUnique({
            where: { id: item.id },
            select: otherLodgeSelect,
          })
        : await ownLodgeByName(name);
      if (existing === "ambiguous") {
        skipped++;
        results.push({ name, status: "skipped", reason: "ambiguous-name" });
        continue;
      }

      const now = new Date();
      // A deleted lodge (#16) is never changed again: the club is told, and
      // nothing is written.
      if (existing?.deletedAt) {
        skipped++;
        results.push({ id: existing.id, name, status: "skipped", reason: "deleted" });
        continue;
      }
      // The seasons as this item would leave them (its dates over the stored
      // row's): two that share a day are refused for this lodge, `seasons`.
      if (seasonDatesProblem(seasonDatesAfter(existing, item))) {
        skipped++;
        results.push({ ...(existing ? { id: existing.id } : {}), name, status: "skipped", reason: "seasons" });
        continue;
      }
      if (!existing && item.id) {
        // An id this server never issued. Never a create: the club believes
        // the lodge exists, and creating it under a new id would fork it.
        skipped++;
        results.push({ id: item.id, name, status: "skipped", reason: "unknown-id" });
        continue;
      }
      if (!existing) {
        const row = await prisma.otherLodge.create({
          data: {
            name,
            ...itemData(item),
            ...(item.amenities
              ? { amenities: { create: amenityCreateRows(item.amenities) } }
              : {}),
            sourceClubId: club.id,
            lastUpdatedByClubId: club.id,
            lastUploadedAt: now,
          },
          select: { id: true },
        });
        created++;
        createdLodges.push({ id: row.id, name });
        results.push({ id: row.id, name, status: "created" });
      } else if (existing.sourceClubId === club.id) {
        // A rename is only reachable by id; a name match is the same name.
        const renamedFrom = item.id !== undefined && existing.name !== name ? existing.name : null;
        const data = itemData(item);
        // Only write (and bump `updatedAt`) when a column actually changed, so an
        // unchanged re-upload does not churn the row or the distribution cursor.
        // A rename is a change: the moved `updatedAt` is what carries the new
        // name to every other club's next incremental pull.
        const amenitiesChanged =
          item.amenities !== undefined &&
          amenitiesDiffer(existing.amenities, item.amenities);
        if (renamedFrom !== null || itemDiffers(data, existing) || amenitiesChanged) {
          const write = {
            ...data,
            ...(renamedFrom !== null ? { name } : {}),
            lastUpdatedByClubId: club.id,
            lastUploadedAt: now,
            // Moved explicitly: when only the amenities changed no column above
            // does it, and the incremental pull is keyed on this column.
            updatedAt: now,
          };
          try {
            if (amenitiesChanged && item.amenities) {
              const amenities = item.amenities;
              // Row first: its lock serialises the amenity replacement against
              // any overlapping writer (see replaceAmenities).
              await prisma.$transaction(async (tx) => {
                await tx.otherLodge.update({ where: { id: existing.id, deletedAt: null }, data: write });
                await replaceAmenities(tx, existing.id, amenities, existing.amenities);
              });
            } else {
              await prisma.otherLodge.update({
                // Not if an admin deleted it since the read (#16).
                where: { id: existing.id, deletedAt: null },
                data: write,
              });
            }
          } catch (error) {
            // Deleted by an admin since the read (#16): nothing was written.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
              skipped++;
              results.push({ id: existing.id, name, status: "skipped", reason: "deleted" });
              continue;
            }
            throw error;
          }
          updated++;
          if (renamedFrom !== null) {
            renamed++;
            renamedLodges.push({ id: existing.id, from: renamedFrom, to: name });
          }
          results.push({ id: existing.id, name, status: "updated" });
        } else {
          unchanged++;
          results.push({ id: existing.id, name, status: "unchanged" });
        }
      } else {
        skipped++;
        results.push({
          id: existing.id,
          name,
          status: "skipped",
          reason: existing.sourceClubId === null ? "owned-centrally" : "owned-by-other-club",
        });
      }
    }
  } finally {
    // In a `finally` so an upload that fails part-way is still audited, with
    // the counts it reached; `completed` says whether it got to the end.
    await recordAudit({
      action: "otherLodge.upload",
      clubId: club.id,
      tokenId: token.id,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
      metadata: {
        created,
        updated,
        unchanged,
        skipped,
        renamed,
        createdLodges,
        renamedLodges,
        total: parsed.data.lodges.length,
        completed: created + updated + unchanged + skipped === parsed.data.lodges.length,
      },
    });
  }

  return NextResponse.json({ created, updated, unchanged, skipped, results });
}
