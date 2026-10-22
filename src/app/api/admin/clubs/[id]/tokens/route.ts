import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardAdminWrite } from "@/lib/admin-guard";
import { issueClubToken } from "@/lib/issue-club-token";
import { createTokenSchema } from "@/lib/validation";

/**
 * POST /api/admin/clubs/:id/tokens
 *
 * Admin/Manager-only. Generates a new API key for an APPROVED club through
 * `issueClubToken` (#30, the one issuer registration also uses). The plaintext
 * is returned ONCE in the response body and never persisted.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardAdminWrite(req, "manager");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const club = await prisma.club.findUnique({ where: { id } });
  if (!club) {
    return NextResponse.json({ error: "Club not found" }, { status: 404 });
  }
  if (club.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Tokens can only be issued to approved clubs" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = createTokenSchema.safeParse({
    name: body?.name ?? "Default key",
    scopes: body?.scopes,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token request" }, { status: 400 });
  }

  const issued = await issueClubToken({
    clubId: club.id,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    source: "admin",
  });

  // `plaintext` is shown to the operator exactly once here.
  return NextResponse.json(issued, { status: 201 });
}
