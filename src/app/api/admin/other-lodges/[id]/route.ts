import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import {
  normalizeOtherLodgeText,
  otherLodgeSelect,
  otherLodgeUpdateSchema,
  serializeOtherLodge,
} from "@/lib/other-lodges";

/** PATCH /api/admin/other-lodges/:id — update fields / toggle distribution. */
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
  // just toggling `distribute`) never clears the other columns.
  const data: Prisma.OtherLodgeUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
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
  if (parsed.data.distribute !== undefined)
    data.distribute = parsed.data.distribute;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ otherLodge: serializeOtherLodge(existing) });
  }

  let updated;
  try {
    updated = await prisma.otherLodge.update({
      where: { id: existing.id },
      data,
      select: otherLodgeSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A lodge with that name already exists." },
        { status: 409 },
      );
    }
    throw error;
  }

  await recordAudit({
    action: "otherLodge.update",
    ipAddress: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata: {
      id: updated.id,
      changedFields: Object.keys(data),
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
