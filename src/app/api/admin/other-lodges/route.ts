import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
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
  serializeOtherLodge,
  similarLodgeNameMessage,
} from "@/lib/other-lodges";
import {
  chosenPictureLabel,
  missingPictureMessage,
  validateLodgePictures,
} from "@/lib/lodge-pictures";

/** GET /api/admin/other-lodges — list the registry (admin/manager). */
export async function GET() {
  try {
    await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

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
  let session;
  try {
    session = await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

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

  const pictureError = await validateLodgePictures(parsed.data);
  if (pictureError) {
    return NextResponse.json({ error: pictureError }, { status: 400 });
  }

  // A name that only LOOKS like an existing one (see normalizeLodgeNameKey).
  // The table is small, so every name is compared; the check is app-level and
  // a concurrent create can slip past it — the unique index still holds the
  // exact name.
  const name = parsed.data.name.trim();
  const similar = findSimilarLodgeName(
    name,
    (await prisma.otherLodge.findMany({ select: { name: true } })).map((l) => l.name),
  );
  if (similar) {
    return NextResponse.json(
      { error: similarLodgeNameMessage(similar) },
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
      // Unique(name): duplicate typed by the admin or a concurrent create.
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A lodge with that name already exists." },
          { status: 409 },
        );
      }
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
