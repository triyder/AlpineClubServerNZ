import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-switcher";
import type { SessionPayload } from "@/lib/auth/session-token";

export function ConsoleShell({
  session,
  children,
}: {
  session: SessionPayload;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/dashboard" className="font-semibold">
              AlpineClubServerNZ
            </Link>
            {/* Wraps on a narrow screen rather than overflowing the header. */}
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/clubs" className="hover:text-foreground">
                Clubs
              </Link>
              <Link href="/lodges" className="hover:text-foreground">
                Lodges
              </Link>
              {/* Images and Issues are admin/manager screens; a plain USER
                  would only be redirected by each page's own guard, which is
                  still what enforces it. */}
              {session.role !== "USER" && (
                <>
                  <Link href="/admin/image-manager" className="hover:text-foreground">
                    Images
                  </Link>
                  <Link href="/issues" className="hover:text-foreground">
                    Issues
                  </Link>
                </>
              )}
              <Link href="/audit" className="hover:text-foreground">
                Audit
              </Link>
              {/* The Communication Portal screens are ADMIN-only, so they are
                  hidden from anyone who would only be bounced by the page
                  guard. The guard is still what enforces it. */}
              {session.role === "ADMIN" && (
                <>
                  <Link href="/posts" className="hover:text-foreground">
                    Posts
                  </Link>
                  <Link href="/settings" className="hover:text-foreground">
                    Settings
                  </Link>
                </>
              )}
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
