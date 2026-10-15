import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { seasonDatesProblem } from "@/lib/lodge-seasons";
import { guardAdminSession, guardAdminWrite } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import {
  amenityCreateRows,
  findSimilarLodgeName,
  lodgeDetailColumns,
  normalizeOtherLodgeText,
  otherLodgeCreateSchema,
  otherLodgeOrderBy,
  otherLodgeSelect,
  seasonDatesAfter,
  liveOtherLodgeWhere,
  serializeOtherLodge,
  SIMILAR_LODGE_NAME_CODE,
  similarLodgeNameMessage,
} from "@/lib/other-lodges";
import {
  chosenPictureLabel,
  missingPictureMessage,
  validateLodgePictures,
} from "@/lib/lodge-pictures";

/** GET /api/admin/other-lodges — list the registry (admin/manager). */
export async function GET() {
  const guard = await guardAdminSession("manager");
  if (!guard.ok) return guard.response;

  const otherLodges = await prisma.otherLodge.findMany({
    orderBy: otherLodgeOrderBy(),
    select: otherLodgeSelect,
  });

  return NextResponse.json({
    otherLodges: otherLodges.map(serializeOtherLodge),
  });
}

/** POST /api/admin/other-lodges — create a registry entry. */
export async function POST(req: Request) {
  const guard = await guardAdminWrite(req, "manager");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = otherLodgeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // The seasons as they will be used (`@/lib/lodge-seasons`): no overlap.
  const seasonProblem = seasonDatesProblem(seasonDatesAfter(null, parsed.data));
  if (seasonProblem) {
    return NextResponse.json({ error: seasonProblem }, { status: 400 });
  }

  const pictureError = await validateLodgePictures(parsed.data);
  if (pictureError) {
    return NextResponse.json({ error: pictureError }, { status: 400 });
  }

  // Names are not unique (#69), but a name another live lodge has, or one
  // that only LOOKS like it (see normalizeLodgeNameKey), is checked with the
  // administrator first: a 409 the admin page answers by resending with
  // `allowSimilarName`. The table is small, so every name is compared.
  const name = parsed.data.name.trim();
  const similar = parsed.data.allowSimilarName
    ? null
    : findSimilarLodgeName(
        name,
        (
          await prisma.otherLodge.findMany({ where: liveOtherLodgeWhere, select: { name: true } })
        ).map((l) => l.name),
      );
  if (similar) {
    return NextResponse.json(
      { error: similarLodgeNameMessage(similar), code: SIMILAR_LODGE_NAME_CODE, similarTo: similar },
      { status: 409 },
    );
  }

  let created;
  try {
    created = await prisma.otherLodge.create({
      data: {
        name,
        location: normalizeOtherLodgeText(parsed.data.location),
        bookingOfficerName: normalizeOtherLodgeText(parsed.data.bookingOfficerName),
        bookingOfficerEmail: normalizeOtherLodgeText(parsed.data.bookingOfficerEmail),
        bookingOfficerPhone: normalizeOtherLodgeText(parsed.data.bookingOfficerPhone),
        bedCapacity: parsed.data.bedCapacity ?? null,
        ...lodgeDetailColumns(parsed.data),
        ...(parsed.data.imageId
          ? { image: { connect: { id: parsed.data.imageId } } }
          : {}),
        ...(parsed.data.logoId
          ? { logo: { connect: { id: parsed.data.logoId } } }
          : {}),
        // Created in the same write as the lodge, so the lodge never exists
        // half-described.
        ...(parsed.data.amenities
          ? { amenities: { create: amenityCreateRows(parsed.data.amenities) } }
          : {}),
      },
      select: otherLodgeSelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // A chosen picture deleted between the check above and this write.
      const picture = error.code === "P2025" ? chosenPictureLabel(parsed.data) : null;
      if (picture) {
        return NextResponse.json(
          { error: missingPictureMessage(picture) },
          { status: 400 },
        );
      }
    }
    throw error;
  }

  await recordAudit({
    action: "otherLodge.create",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { id: created.id, name: created.name, by: session.userId },
  });

  return NextResponse.json(
    { otherLodge: serializeOtherLodge(created) },
    { status: 201 },
  );
}
