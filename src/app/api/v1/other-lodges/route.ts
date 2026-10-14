import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enforceClientApiVersion } from "@/lib/api-version-gate";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  amenitiesDiffer,
  amenityCreateRows,
  buildOtherLodgePullEnvelope,
  findSimilarLodgeName,
  lodgeDetailColumns,
  lodgeDetailDiffers,
  normalizeOtherLodgeText,
  otherLodgeOrderBy,
  otherLodgePullCursor,
  otherLodgeSelect,
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
  // Deletions (#16) ride the same `since`: every tombstone newer than the
  // club's cursor, or all of them on a pull without one, so a club that was
  // away still removes every lodge deleted meanwhile.
  const [lodges, owned, deletedLodges] = await Promise.all([
    prisma.otherLodge.findMany({
      where: {
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      orderBy: otherLodgeOrderBy(),
      select: otherLodgeSelect,
    }),
    prisma.otherLodge.findMany({
      where: { sourceClubId: club.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.deletedOtherLodge.findMany({
      where: since ? { deletedAt: { gt: since } } : {},
      orderBy: { deletedAt: "asc" },
      select: { id: true, deletedAt: true },
    }),
  ]);

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
 * A club pushes its "Other lodges" entries. Each is keyed by unique `name` and
 * OWNED by the uploading club:
 *   - new name           -> created (sourceClub = this club), unless it only
 *                            LOOKS like an existing name (`similar-name`)
 *   - name owned by club  -> updated (every field the item carries: contact,
 *                            capacity, the detail fields and the amenity set)
 *   - name owned by other -> skipped (a club can't clobber central or another
 *                            club's entry)
 *
 * An item that quotes the lodge's `id` (API 2.3) is keyed by that id instead:
 *   - id of a lodge the club owns -> updated, and RENAMED when `name` differs,
 *                            unless the new name is held by another lodge
 *                            (`name-taken`) or only looks like one
 *                            (`similar-name`); a refused rename writes nothing
 *   - id owned by other   -> skipped, as for a name
 *   - id not known        -> skipped (`unknown-id`), never created
 * A rename moves `updatedAt`, so every other club's next pull carries the new
 * name under the same id and renames its copy in place.
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

  // Every stored name, loaded once and only when a create needs it, for the
  // lookalike check (see normalizeLodgeNameKey). Application-level and so
  // race-prone by design: a lookalike created concurrently is not caught, only
  // an exact duplicate is (by the unique index, below).
  let knownNames: string[] | null = null;
  // `ownName` (a rename) is the lodge's current name, which is never a rival.
  const nameSimilarTo = async (name: string, ownName?: string) => {
    knownNames ??= (
      await prisma.otherLodge.findMany({ select: { name: true } })
    ).map((l) => l.name);
    return findSimilarLodgeName(
      name,
      ownName === undefined ? knownNames : knownNames.filter((n) => n !== ownName),
    );
  };
  // A name created by THIS upload counts for the items after it.
  const noteCreated = (name: string) => {
    knownNames?.push(name);
  };
  // A rename moves a name: the old one is free for the items after it, and
  // the new one is taken.
  const noteRenamed = (from: string, to: string) => {
    if (!knownNames) return;
    const at = knownNames.indexOf(from);
    if (at >= 0) knownNames[at] = to;
    else knownNames.push(to);
  };

  try {
    for (const item of parsed.data.lodges) {
      const name = item.name.trim();
      // API 2.3: an item that quotes the lodge's id is matched BY ID, so its
      // name may differ (a rename). Without an id, by name, as before.
      const existing = item.id
        ? await prisma.otherLodge.findUnique({
            where: { id: item.id },
            select: otherLodgeSelect,
          })
        : await prisma.otherLodge.findUnique({
            where: { name },
            select: otherLodgeSelect,
          });

      const now = new Date();
      if (!existing && item.id) {
        // An id this server never issued, or a lodge since deleted. Never a
        // create: the club believes the lodge exists, and creating it under a
        // new id would silently fork it.
        skipped++;
        results.push({ name, status: "skipped", reason: "unknown-id" });
        continue;
      }
      if (!existing) {
        if (await nameSimilarTo(name)) {
          skipped++;
          results.push({ name, status: "skipped", reason: "similar-name" });
          continue;
        }
        try {
          await prisma.otherLodge.create({
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
          });
          created++;
          noteCreated(name);
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
        // A rename (only reachable by id): the new name must be free and must
        // not merely LOOK like another lodge's, exactly as for a create. The
        // lodge's own current name is not a rival, so a change of case or
        // spacing alone is allowed.
        const renamedFrom = item.id !== undefined && existing.name !== name ? existing.name : null;
        if (renamedFrom !== null) {
          const holder = await prisma.otherLodge.findUnique({
            where: { name },
            select: { id: true },
          });
          if (holder) {
            skipped++;
            results.push({ name, status: "skipped", reason: "name-taken" });
            continue;
          }
          if (await nameSimilarTo(name, existing.name)) {
            skipped++;
            results.push({ name, status: "skipped", reason: "similar-name" });
            continue;
          }
        }
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
                await tx.otherLodge.update({ where: { id: existing.id }, data: write });
                await replaceAmenities(tx, existing.id, amenities, existing.amenities);
              });
            } else {
              await prisma.otherLodge.update({
                where: { id: existing.id },
                data: write,
              });
            }
          } catch (error) {
            // A rename onto a name another writer took since the check above.
            if (
              renamedFrom !== null &&
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              skipped++;
              results.push({ name, status: "skipped", reason: "name-taken" });
              continue;
            }
            throw error;
          }
          updated++;
          if (renamedFrom !== null) {
            renamed++;
            noteRenamed(renamedFrom, name);
          }
          results.push({ name, status: "updated" });
        } else {
          unchanged++;
          results.push({ name, status: "unchanged" });
        }
      } else {
        skipped++;
        results.push({
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
        total: parsed.data.lodges.length,
        completed: created + updated + unchanged + skipped === parsed.data.lodges.length,
      },
    });
  }

  return NextResponse.json({ created, updated, unchanged, skipped, results });
}
