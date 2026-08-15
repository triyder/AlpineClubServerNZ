import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { recordAudit } from "@/lib/audit";
import { clientIp } from "@/lib/api-auth";
import {
  normalizeOtherLodgeText,
  otherLodgeCreateSchema,
  otherLodgeOrderBy,
  otherLodgeSelect,
  serializeOtherLodge,
} from "@/lib/other-lodges";

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

  let created;
  try {
    created = await prisma.otherLodge.create({
      data: {
        name: parsed.data.name.trim(),
        location: normalizeOtherLodgeText(parsed.data.location),
        bookingOfficerName: normalizeOtherLodgeText(parsed.data.bookingOfficerName),
        bookingOfficerEmail: normalizeOtherLodgeText(parsed.data.bookingOfficerEmail),
        bookingOfficerPhone: normalizeOtherLodgeText(parsed.data.bookingOfficerPhone),
        bedCapacity: parsed.data.bedCapacity ?? null,
        distribute: parsed.data.distribute ?? false,
      },
      select: otherLodgeSelect,
    });
  } catch (error) {
    // Unique(name): duplicate typed by the admin or a concurrent create.
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
