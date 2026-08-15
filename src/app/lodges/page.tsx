import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ConsoleShell } from "@/components/console-shell";
import { OtherLodgesPanel } from "@/components/other-lodges-panel";

export const dynamic = "force-dynamic";

export default async function LodgesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = session.role === "ADMIN" || session.role === "MANAGER";

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lodges</h1>
          <p className="text-muted-foreground">
            The central &ldquo;Other lodges&rdquo; registry. Connected clubs
            upload entries; those you mark for distribution are shared back out
            to every club connected via its API key.
          </p>
        </div>
        <OtherLodgesPanel canManage={canManage} />
      </div>
    </ConsoleShell>
  );
}
