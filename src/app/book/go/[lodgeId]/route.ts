import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSafeHttpUrl } from "@/lib/other-lodges";

/**
 * GET /book/go/:lodgeId — "Book now". Sends the guest to the lodge's own
 * booking site (its non-member booking page URL); this server never makes a
 * booking.
 *
 * The destination is looked up HERE, at the moment of the click, and checked
 * again with the same rule it was stored under, so the page can only ever send
 * a guest to the URL stored for that lodge — nothing in the request can choose
 * where the redirect goes. An unknown lodge or an empty URL returns to the
 * search with a message rather than an error page.
 *
 * Public, like /book. The guest's dates and numbers are not passed on: each
 * lodge's site expects its own format.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ lodgeId: string }> },
) {
  const { lodgeId } = await params;
  const back = new URL("/book?unavailable=1", req.url);

  // Lodge ids are cuids; anything else is not worth a query.
  if (!/^[a-z0-9]{1,64}$/i.test(lodgeId)) {
    return NextResponse.redirect(back, 303);
  }

  const lodge = await prisma.otherLodge.findUnique({
    where: { id: lodgeId },
    select: { siteUrl: true },
  });
  const url = lodge?.siteUrl?.trim();
  if (!url || !isSafeHttpUrl(url)) {
    return NextResponse.redirect(back, 303);
  }

  return NextResponse.redirect(url, 303);
}
