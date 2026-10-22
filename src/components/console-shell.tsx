import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-switcher";
import type { SessionPayload } from "@/lib/auth/session-token";

/**
 * The signed-in console's header (#32).
 *
 * Top level: Dashboard, Connections (the clubs linked to this server, at
 * `/clubs`), Lodges, Posts, and an **Admin** menu that gathers the
 * administrative screens — Settings, Audit, Issues, Images — so they sit as a
 * group rather than as peers of the day-to-day pages. The menu is a native
 * `<details>` so it needs no client JavaScript and works with the keyboard.
 *
 * Role gating here is only about what is SHOWN: each page's own guard is still
 * what enforces who may open it.
 */
const LINK = "hover:text-foreground";
const MENU_ITEM = `block rounded px-3 py-1.5 ${LINK} hover:bg-muted`;

export function ConsoleShell({
  session,
  children,
}: {
  session: SessionPayload;
  children: React.ReactNode;
}) {
  const staff = session.role !== "USER";
  const admin = session.role === "ADMIN";
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/dashboard" className="font-semibold">
              AlpineClubServerNZ
            </Link>
            {/* Wraps on a narrow screen rather than overflowing the header. */}
            <nav
              aria-label="Console"
              className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
            >
              <Link href="/dashboard" className={LINK}>
                Dashboard
              </Link>
              <Link href="/clubs" className={LINK}>
                Connections
              </Link>
              <Link href="/lodges" className={LINK}>
                Lodges
              </Link>
              {/* The Communication Portal screens are ADMIN-only, so they are
                  hidden from anyone who would only be bounced by the page
                  guard. */}
              {admin && (
                <Link href="/posts" className={LINK}>
                  Posts
                </Link>
              )}
              <details className="relative">
                <summary
                  className={`cursor-pointer list-none ${LINK} [&::-webkit-details-marker]:hidden`}
                >
                  Admin
                  <span aria-hidden className="ml-1 text-xs">
                    ▾
                  </span>
                </summary>
                <ul
                  aria-label="Admin"
                  className="absolute left-0 z-20 mt-2 min-w-40 rounded-md border border-border bg-background p-1 shadow-md"
                >
                  {admin && (
                    <li>
                      <Link href="/settings" className={MENU_ITEM}>
                        Settings
                      </Link>
                    </li>
                  )}
                  <li>
                    <Link href="/audit" className={MENU_ITEM}>
                      Audit
                    </Link>
                  </li>
                  {/* Issues and Images are admin/manager screens; a plain USER
                      would only be redirected by each page's own guard. */}
                  {staff && (
                    <>
                      <li>
                        <Link href="/issues" className={MENU_ITEM}>
                          Issues
                        </Link>
                      </li>
                      <li>
                        <Link href="/admin/image-manager" className={MENU_ITEM}>
                          Images
                        </Link>
                      </li>
                    </>
                  )}
                </ul>
              </details>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/profile"
              className="text-muted-foreground hover:text-foreground"
            >
              {session.email} · {session.role}
            </Link>
            <ThemeToggle />
            <form action="/logout" method="post">
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
