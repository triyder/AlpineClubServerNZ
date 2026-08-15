import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">AlpineClubServerNZ</h1>
        <p className="text-muted-foreground">
          Central hub connecting AlpineClubBookingsNZ installations. Sign in to
          manage linked clubs and API access, or register a lodge to request a
          connection.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/login">Admin sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">Register a lodge</Link>
        </Button>
      </div>
    </main>
  );
}
