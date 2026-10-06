import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import {
  amenitiesDiffer,
  findSimilarLodgeName,
  lodgeDetailColumns,
  normalizeOtherLodgeText,
  otherLodgeSelect,
  otherLodgeUpdateSchema,
  serializeOtherLodge,
  similarLodgeNameMessage,
} from "@/lib/other-lodges";
import { replaceAmenities } from "@/lib/other-lodge-amenities";
import {
  chosenPictureLabel,
  missingPictureMessage,
  validateLodgePictures,
} from "@/lib/lodge-pictures";

/** PATCH /api/admin/other-lodges/:id — update fields. */
export async function PATCH(
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
  if (!id) {
    return NextResponse.json({ error: "Invalid lodge id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = otherLodgeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const existing = await prisma.otherLodge.findUnique({
    where: { id },
    select: otherLodgeSelect,
  });
  if (!existing) {
    return NextResponse.json({ error: "Lodge not found" }, { status: 404 });
  }

  // Only assign the fields that were actually provided so a partial PATCH (e.g.
  // just the bed count) never clears the other columns.
  const data: Prisma.OtherLodgeUpdateInput = {};
  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim();
    if (name !== existing.name) {
      // A rename to a name that only LOOKS like another lodge's (see
      // normalizeLodgeNameKey). App-level and race-prone by design; the unique
      // index still holds the exact name.
      const others = await prisma.otherLodge.findMany({
        where: { id: { not: existing.id } },
        select: { name: true },
      });
      const similar = findSimilarLodgeName(name, others.map((l) => l.name));
      if (similar) {
        return NextResponse.json(
          { error: similarLodgeNameMessage(similar) },
          { status: 409 },
        );
      }
    }
    data.name = name;
  }
  if (parsed.data.location !== undefined)
    data.location = normalizeOtherLodgeText(parsed.data.location);
  if (parsed.data.bookingOfficerName !== undefined)
    data.bookingOfficerName = normalizeOtherLodgeText(parsed.data.bookingOfficerName);
  if (parsed.data.bookingOfficerEmail !== undefined)
    data.bookingOfficerEmail = normalizeOtherLodgeText(parsed.data.bookingOfficerEmail);
  if (parsed.data.bookingOfficerPhone !== undefined)
    data.bookingOfficerPhone = normalizeOtherLodgeText(parsed.data.bookingOfficerPhone);
  if (parsed.data.bedCapacity !== undefined)
    data.bedCapacity = parsed.data.bedCapacity;
  Object.assign(data, lodgeDetailColumns(parsed.data));

  // The picture and logo: a string chooses one from the library, null clears it,
  // absent leaves it alone. Checked against the library first.
  if (parsed.data.imageId !== undefined || parsed.data.logoId !== undefined) {
    const pictureError = await validateLodgePictures(parsed.data);
    if (pictureError) {
      return NextResponse.json({ error: pictureError }, { status: 400 });
    }
  }
  if (parsed.data.imageId !== undefined) {
    data.image = parsed.data.imageId
      ? { connect: { id: parsed.data.imageId } }
      : { disconnect: true };
  }
  if (parsed.data.logoId !== undefined) {
    data.logo = parsed.data.logoId
      ? { connect: { id: parsed.data.logoId } }
      : { disconnect: true };
  }

  const amenities = parsed.data.amenities;
  const amenitiesChanged =
    amenities !== undefined && amenitiesDiffer(existing.amenities, amenities);
  if (Object.keys(data).length === 0 && !amenitiesChanged) {
    return NextResponse.json({ otherLodge: serializeOtherLodge(existing) });
  }

  // An administrator's edit is now the latest change, so the Source column must
  // stop crediting the club that last uploaded this lodge.
  const adminProvenance = {
    lastUpdatedByClub: { disconnect: true },
    lastUploadedAt: null,
  } satisfies Prisma.OtherLodgeUpdateInput;

  let updated;
  try {
    if (amenities === undefined || !amenitiesChanged) {
      updated = await prisma.otherLodge.update({
        where: { id: existing.id },
        data: { ...data, ...adminProvenance },
        select: otherLodgeSelect,
      });
    } else {
      // The lodge row and its amenities change together or not at all, and the
      // ROW IS WRITTEN FIRST: that takes its lock for the rest of the
      // transaction, so an overlapping writer's amenity replacement waits
      // behind this one instead of interleaving into a union of both sets
      // (see replaceAmenities). When ONLY the amenities changed, the lodge's
      // own `updatedAt` is moved by hand — the incremental pull is keyed on
      // that column, so leaving it alone would hide the edit from every club.
      updated = await prisma.$transaction(async (tx) => {
        const scalar: Prisma.OtherLodgeUpdateInput = { ...data };
        if (Object.keys(scalar).length === 0) scalar.updatedAt = new Date();
        await tx.otherLodge.update({
          where: { id: existing.id },
          data: { ...scalar, ...adminProvenance },
        });
        await replaceAmenities(tx, existing.id, amenities, existing.amenities);
        return tx.otherLodge.findUniqueOrThrow({
          where: { id: existing.id },
          select: otherLodgeSelect,
        });
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
    action: "otherLodge.update",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: {
      id: updated.id,
      changedFields: [
        ...Object.keys(data),
        ...(amenitiesChanged ? ["amenities"] : []),
      ],
      by: session.userId,
    },
  });

  return NextResponse.json({ otherLodge: serializeOtherLodge(updated) });
}

/** DELETE /api/admin/other-lodges/:id — remove a registry entry. */
export async function DELETE(
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
  if (!id) {
    return NextResponse.json({ error: "Invalid lodge id" }, { status: 400 });
  }

  const existing = await prisma.otherLodge.findUnique({
    where: { id },
    select: otherLodgeSelect,
  });
  if (!existing) {
    return NextResponse.json({ error: "Lodge not found" }, { status: 404 });
  }

  await prisma.otherLodge.delete({ where: { id: existing.id } });

  await recordAudit({
    action: "otherLodge.delete",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: { id: existing.id, name: existing.name, by: session.userId },
  });

  return NextResponse.json({ ok: true });
}
