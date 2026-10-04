import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import { assignClubLodges } from "@/lib/club-lodges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assignSchema = z
  .object({
    lodgeIds: z.array(z.string().trim().min(1).max(64)).max(500),
  })
  .strict();

/**
 * PUT /api/admin/clubs/:id/lodges — set the lodges an APPROVED club owns.
 *
 * Body: `{ lodgeIds: string[] }`, the club's COMPLETE list (an empty list gives
 * every lodge back to central ownership). Administrators and managers only.
 * All-or-nothing: see `assignClubLodges`.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const club = await prisma.club.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (club.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Lodges can only be assigned to approved clubs" },
      { status: 409 },
    );
  }

  const result = await assignClubLodges(club.id, parsed.data.lodgeIds);
  if (!result.ok) {
    if (result.reason === "missing") {
      return NextResponse.json(
        { error: "A chosen lodge no longer exists. Reload and try again." },
        { status: 400 },
      );
    }
    if (result.reason === "owned") {
      const names = result.lodges
        .map((l) => (l.club ? `${l.name} (${l.club})` : l.name))
        .join(", ");
      return NextResponse.json(
        {
          error: `Already assigned to another club: ${names}. Remove it from that club first.`,
          lodges: result.lodges,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "A lodge was assigned while you were saving. Reload and try again." },
      { status: 409 },
    );
  }

  await recordAudit({
    action: "club.lodges.assign",
    clubId: club.id,
    userId: session.userId,
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { added: result.added, removed: result.removed },
  });

  const owned = await prisma.otherLodge.findMany({
    where: { sourceClubId: club.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ lodges: owned });
}
