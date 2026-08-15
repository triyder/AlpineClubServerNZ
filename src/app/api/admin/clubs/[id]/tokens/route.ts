import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireManager } from "@/lib/admin-guard";
import { generateApiToken } from "@/lib/api-tokens";
import { createTokenSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

/**
 * POST /api/admin/clubs/:id/tokens
 *
 * Admin/Manager-only. Generates a new API key for an APPROVED club. The
 * plaintext token is returned ONCE in the response body and never persisted —
 * only its hash and non-secret prefix are stored.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireManager();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

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

  const generated = generateApiToken();
  const token = await prisma.apiToken.create({
    data: {
      clubId: club.id,
      name: parsed.data.name,
      tokenHash: generated.hash,
      tokenPrefix: generated.prefix,
      scopes: parsed.data.scopes,
    },
  });

  await recordAudit({
    action: "token.generate",
    clubId: club.id,
    tokenId: token.id,
    metadata: { name: token.name, scopes: token.scopes },
  });

  // `plaintext` is shown to the operator exactly once here.
  return NextResponse.json(
    {
      id: token.id,
      name: token.name,
      prefix: token.tokenPrefix,
      scopes: token.scopes,
      plaintext: generated.plaintext,
    },
    { status: 201 },
  );
}
