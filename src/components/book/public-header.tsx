import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The public pages' header (#25): the name, and links to the bed planner and
 * the admin sign-in. Registering a lodge is an administrator's action and is
 * reached from the console's Connections page (#32), not from here; the
 * `/register` page itself stays public for a club following its site's link. Leaves room on the right for the fixed theme toggle
 * (`PublicThemeCorner`).
 */

export const PUBLIC_SITE_NAME = "Alpine Club Lodges NZ";

const LINKS = [
  { key: "book", href: "/book", label: "Bed planner" },
  { key: "login", href: "/login", label: "Admin sign in" },
] as const;

export function PublicHeader({ current }: { current?: (typeof LINKS)[number]["key"] }) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 py-3 pl-4 pr-16 sm:pl-6">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight">
          <svg width="28" height="28" viewBox="0 0 30 30" aria-hidden className="text-primary">
            <rect x="2" y="4" width="26" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M2 11 H28 M11 11 V26 M19 11 V26" stroke="currentColor" strokeWidth="2.2" />
          </svg>
          {PUBLIC_SITE_NAME}
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              aria-current={current === l.key ? "page" : undefined}
              className={cn(
                "underline-offset-4 hover:underline",
                current === l.key ? "text-foreground underline" : "text-muted-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
