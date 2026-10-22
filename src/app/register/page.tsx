import { prisma } from "@/lib/db";
import { liveOtherLodgeWhere } from "@/lib/other-lodges";
import { PublicHeader } from "@/components/book/public-header";
import type { ClubLodgeOption } from "@/components/club-lodges-select";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

/**
 * `/register` (#30, #40): the public registration page. Loads every live lodge
 * with its owner so the form can offer the free ones and show who holds the
 * rest; the form itself is a client island.
 */
export default async function RegisterPage() {
  const lodges = await prisma.otherLodge.findMany({
    where: liveOtherLodgeWhere,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, sourceClubId: true, sourceClub: { select: { name: true } } },
  });
  const lodgeOptions: ClubLodgeOption[] = lodges.map((l) => ({
    id: l.id,
    name: l.name,
    ownerClubId: l.sourceClubId,
    ownerClubName: l.sourceClub?.name ?? null,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <RegisterForm lodgeOptions={lodgeOptions} />
      </main>
    </div>
  );
}
