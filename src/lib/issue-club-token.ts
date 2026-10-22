import { prisma } from "@/lib/db";
import { generateApiToken } from "@/lib/api-tokens";
import { createTokenSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";

/**
 * The ONE place an API key is minted for a club (#30).
 *
 * Two callers: the admin's "generate key" on the Connections page
 * (`POST /api/admin/clubs/:id/tokens`), and a club's own registration, which
 * hands the club its first key on the registration-complete page so it can be
 * pasted into the club's site straight away. Both go through here so the
 * hashing, the stored shape and the audit entry cannot drift apart.
 *
 * The plaintext is returned exactly once and never persisted: only its SHA-256
 * hash and its non-secret lookup prefix are stored. A key for a club that is
 * still PENDING is minted but refused by `authenticateApiRequest` until an
 * administrator approves the club, which is what makes issuing it at
 * registration safe: nothing is reachable with it until a person says so.
 */
export interface IssuedClubToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /** Shown to its holder exactly once; never stored. */
  plaintext: string;
}

export async function issueClubToken(input: {
  clubId: string;
  name?: string;
  scopes?: string[];
  /** Where the request came from, for the audit trail: "admin" or "register". */
  source: "admin" | "register";
}): Promise<IssuedClubToken> {
  const parsed = createTokenSchema.parse({
    name: input.name ?? "Default key",
    scopes: input.scopes,
  });

  const generated = generateApiToken();
  const token = await prisma.apiToken.create({
    data: {
      clubId: input.clubId,
      name: parsed.name,
      tokenHash: generated.hash,
      tokenPrefix: generated.prefix,
      scopes: parsed.scopes,
    },
  });

  await recordAudit({
    action: "token.generate",
    clubId: input.clubId,
    tokenId: token.id,
    metadata: { name: token.name, scopes: token.scopes, source: input.source },
  });

  return {
    id: token.id,
    name: token.name,
    prefix: token.tokenPrefix,
    scopes: token.scopes,
    plaintext: generated.plaintext,
  };
}
