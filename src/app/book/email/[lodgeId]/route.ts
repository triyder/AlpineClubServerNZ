import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { liveOtherLodgeWhere } from "@/lib/other-lodges";

/**
 * GET /book/email/:lodgeId — the booking officer's email, for "Email the club"
 * (owner, 18 Oct 2026): a lodge with no non-member booking page but an email.
 *
 * The address is NOT written into the public page, where any crawler would
 * collect it; the button asks for it here when a guest presses it. Only for a
 * live lodge with no booking page (one with a page is booked there instead);
 * a few requests per caller address per window; never cached. Every other
 * case is the same 404, so probing says nothing about a lodge.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Requests per caller address per rate-limit window. */
const EMAIL_PER_WINDOW = 10;

const noStore = { "Cache-Control": "no-store" };
const notFound = () => NextResponse.json({ error: "No email for this lodge" }, { status: 404, headers: noStore });

export async function GET(req: Request, { params }: { params: Promise<{ lodgeId: string }> }) {
  const { lodgeId } = await params;
  // Lodge ids are cuids; anything else is not worth a query.
  if (!/^[a-z0-9]{1,64}$/i.test(lodgeId)) return notFound();
  if (!checkRateLimit(`book:email:${clientIp(req) ?? "unknown"}`, Date.now(), EMAIL_PER_WINDOW).allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429, headers: noStore });
  }

  const lodge = await prisma.otherLodge.findFirst({
    where: { id: lodgeId, ...liveOtherLodgeWhere },
    select: { siteUrl: true, bookingOfficerEmail: true },
  });
  const email = lodge?.bookingOfficerEmail?.trim();
  if (!lodge || lodge.siteUrl?.trim() || !email) return notFound();
  return NextResponse.json({ email }, { headers: noStore });
}
