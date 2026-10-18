import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import {
  GUEST_FIELDS,
  GUESTS_PER_GROUP_MAX,
  guestFieldLabel,
  todayInNz,
} from "@/lib/lodge-search";
import { quickPickStay, type QuickPick } from "@/lib/bed-planner";
import { PublicHeader } from "@/components/book/public-header";
import { LeaveFollowsArrive } from "@/components/book/leave-follows-arrive";

/**
 * The public home page (#25; owner's layout, 18 Oct 2026): Option A's "Stay at
 * a club lodge in the mountains" banner with its search, the three quick picks
 * under it, the bed planner's three points, and the club panel. Signed-in
 * operators go straight to the console.
 *
 * One plain GET form to `/book`: "Search lodges" sends the dates typed; each
 * quick pick is a submit button carrying `when=` (no date check, so the date
 * boxes may be empty), which the planner turns into dates (`applyQuickPick`).
 * Either way the guest numbers typed go with it, and it works without
 * JavaScript.
 */

const PINE = "bg-[#1F4D34]";
const SIGNAL = "bg-[#C2410C] hover:bg-[#9A3412]";

const POINTS = [
  {
    title: "Live from the club",
    text: "Free beds are asked from each club's own booking site unless unavailable where you can still try to book directly with the club.",
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

const PICKS: Array<{ when: QuickPick; label: string }> = [
  { when: "this-weekend", label: "This weekend" },
  { when: "next-weekend", label: "Next weekend" },
  { when: "school-holidays", label: "School holidays" },
];

const fieldClass =
  "h-12 w-full rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }
  const today = todayInNz();
  // A pick with no dates behind it (no school holidays listed ahead) is not offered.
  const picks = PICKS.filter((p) => quickPickStay(p.when, today) !== null);

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main>
        <section className={`${PINE} text-white`}>
          <div className="mx-auto flex max-w-6xl flex-col gap-7 px-4 pb-16 pt-14 sm:px-6 sm:pb-20">
            <p className="self-start rounded bg-[#C2410C] px-3 py-1 text-sm font-bold uppercase tracking-wider">
              Club lodges · Non-member rates
            </p>
            <h1 className="max-w-4xl text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
              Stay at a club lodge in the mountains
            </h1>
            <p className="max-w-2xl text-lg text-[#DCE8DF] sm:text-xl">
              Search lodges run by New Zealand alpine and tramping clubs,
              compare beds and prices, then book directly with the club.
            </p>

            <form method="get" action="/book" className="space-y-4">
              <div className="grid grid-cols-2 items-end gap-4 rounded-xl bg-card p-5 text-card-foreground shadow-2xl lg:grid-cols-[minmax(9.5rem,2fr)_minmax(9.5rem,2fr)_repeat(4,minmax(0,1fr))_auto]">
                <label className="col-span-2 space-y-1.5 text-sm font-semibold sm:col-span-1">
                  <span className="block">Arrive</span>
                  <input
                    id="home-checkIn"
                    name="checkIn"
                    type="date"
                    min={today}
                    required
                    className={fieldClass}
                  />
                </label>
                <label className="col-span-2 space-y-1.5 text-sm font-semibold sm:col-span-1">
                  <span className="block">Leave</span>
                  <input
                    id="home-checkOut"
                    name="checkOut"
                    type="date"
                    min={today}
                    required
                    className={fieldClass}
                  />
                </label>
                {GUEST_FIELDS.map((g) => (
                  <label
                    key={g.key}
                    className="space-y-1.5 text-sm font-semibold"
                  >
                    <span className="block">
                      {guestFieldLabel(g)}
                    </span>
                    <input
                      name={g.key}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={GUESTS_PER_GROUP_MAX}
                      defaultValue={g.key === "adults" ? 2 : 0}
                      className={fieldClass}
                    />
                  </label>
                ))}
                <button
                  type="submit"
                  className={`${SIGNAL} inline-flex h-12 items-center justify-center gap-2 rounded-md px-6 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring col-span-2 lg:col-span-1`}
                >
                  <Search aria-hidden className="h-4 w-4" />
                  Search lodges
                </button>
              </div>

              <LeaveFollowsArrive arriveId="home-checkIn" leaveId="home-checkOut" />
              {picks.length > 0 ? (
                <div
                  role="group"
                  aria-label="Quick picks"
                  className="flex flex-wrap gap-3"
                >
                  {picks.map((p) => (
                    <button
                      key={p.when}
                      type="submit"
                      name="when"
                      value={p.when}
                      formNoValidate
                      className="inline-flex h-11 items-center rounded-full border-2 border-white/80 px-5 font-semibold text-white hover:bg-white hover:text-[#1F4D34] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          </div>
        </section>

        <section
          aria-labelledby="how-heading"
          className="mx-auto max-w-6xl px-4 py-14 sm:px-6"
        >
          <h2 id="how-heading" className="sr-only">
            How it works
          </h2>
          <ol className="grid gap-5 sm:grid-cols-3">
            {POINTS.map((p, i) => (
              <li
                key={p.title}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-6"
              >
                <span
                  aria-hidden
                  className={`${PINE} flex h-9 w-9 items-center justify-center rounded-full font-bold text-white`}
                >
                  {i + 1}
                </span>
                <h3 className="text-lg font-bold">{p.title}</h3>
                <p className="text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-xl bg-[#14231A] p-8 text-white">
            <div className="max-w-2xl space-y-1">
              <h2 className="text-2xl font-extrabold tracking-tight">
                Club lodge on AlpineClubBookingsNZ?
              </h2>
              <p className="text-[#C9D6CC]">
                List your lodge here. Your rates, seasons and free beds come
                straight from your own booking site.
              </p>
            </div>
            <Link
              href="/register"
              className={`${SIGNAL} inline-flex h-11 items-center rounded-lg px-5 font-bold text-white`}
            >
              Register a lodge
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
