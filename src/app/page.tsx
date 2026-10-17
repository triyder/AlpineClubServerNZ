import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { todayInNz } from "@/lib/lodge-search";
import { weekendStays } from "@/lib/bed-planner";
import { PublicHeader } from "@/components/book/public-header";
import { WeekendGrid } from "@/components/book/weekend-grid";

/**
 * The public home page in the "Bed planner" design (#25): where there is room
 * this weekend, with quick picks into the bed planner. Signed-in operators go
 * straight to the console.
 */

function stayHref(stay: { checkIn: string; checkOut: string }): string {
  return `/book?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}`;
}

const POINTS = [
  {
    title: "Live from the club",
    text: "Free beds are asked from each club's own booking site when you look, never guessed.",
  },
  {
    title: "Priced for your group",
    text: "Every night at its season's non-member rate, for infants, children, youth and adults.",
  },
  {
    title: "Booked with the club",
    text: "The club takes your booking and payment on its own site.",
  },
];

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }
  const { thisWeekend, nextWeekend } = weekendStays(todayInNz());

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main>
        <section className="mx-auto flex max-w-6xl flex-wrap items-center gap-10 px-4 py-12 sm:px-6 sm:py-16">
          <div className="min-w-0 flex-[1_1_22rem] space-y-5">
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              Where is there room this weekend?
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              See free beds at club lodges night by night, straight from each club&apos;s booking site. Then book
              with the club.
            </p>
            <nav aria-label="Quick picks" className="flex flex-wrap gap-2">
              <Link
                href={stayHref(thisWeekend)}
                className="inline-flex h-11 items-center rounded-full bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90"
              >
                This weekend
              </Link>
              <Link
                href={stayHref(nextWeekend)}
                className="inline-flex h-11 items-center rounded-full border-2 border-border px-5 font-semibold hover:bg-muted"
              >
                Next weekend
              </Link>
              <Link href="/book" className="inline-flex h-11 items-center rounded-full px-5 font-semibold underline-offset-4 hover:underline">
                Pick dates
              </Link>
            </nav>
          </div>
          <div className="min-w-0 flex-[1_1_30rem]">
            <WeekendGrid checkIn={thisWeekend.checkIn} checkOut={thisWeekend.checkOut} />
          </div>
        </section>

        <section className="border-y border-border bg-muted/40">
          <ul className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
            {POINTS.map((p) => (
              <li key={p.title} className="space-y-1">
                <h2 className="text-lg font-bold">{p.title}</h2>
                <p className="text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-4 py-10 sm:px-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">Club lodge on AlpineClubBookingsNZ?</h2>
            <p className="text-muted-foreground">Put your free beds in front of non-members.</p>
          </div>
          <Link
            href="/register"
            className="inline-flex h-11 items-center rounded-lg bg-primary px-5 font-bold text-primary-foreground hover:bg-primary/90"
          >
            Register a lodge
          </Link>
        </section>
      </main>
    </div>
  );
}
