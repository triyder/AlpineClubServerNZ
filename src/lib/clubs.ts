import "server-only";
import { Prisma, type Club } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ClubRegisterInput } from "@/lib/validation";

export type RegisterClubResult =
  | { ok: true; club: Club; created: boolean }
  | { ok: false; error: string };

/**
 * Register (or re-surface) a club's link request. Shared by the public UI
 * registration form and the `POST /api/v1/clubs/register` endpoint.
 *
 * `code` is unique. If a request with the same code already exists it is NOT
 * overwritten — we return the existing record so a client retrying its
 * registration is idempotent and an attacker cannot mutate an approved club's
 * details by re-registering its code.
 */
export async function registerClub(
  input: ClubRegisterInput,
): Promise<RegisterClubResult> {
  const code = input.code.trim();
  const existing = await prisma.club.findUnique({ where: { code } });
  if (existing) {
    return { ok: true, club: existing, created: false };
  }

  try {
    const club = await prisma.club.create({
      data: {
        name: input.name.trim(),
        code,
        location: input.location?.trim() || null,
        contactEmail: input.contactEmail.toLowerCase().trim(),
        status: "PENDING",
      },
    });
    return { ok: true, club, created: true };
  } catch (err) {
    // Unique-constraint race: another request created the same code between the
    // findUnique above and this create. Return the winner.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const club = await prisma.club.findUnique({ where: { code } });
      if (club) return { ok: true, club, created: false };
    }
    return { ok: false, error: "Could not register club." };
  }
}
