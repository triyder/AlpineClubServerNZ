import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ConsoleShell } from "@/components/console-shell";
import { ImageManagerClient } from "./image-manager-client";

export const dynamic = "force-dynamic";

export default async function ImageManagerPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Same tier as the Lodges screen the pictures are chosen on: ADMIN / MANAGER.
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    redirect("/dashboard");
  }

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Image manager</h1>
          <p className="text-muted-foreground">
            Upload pictures and logos once, then choose them for a lodge on the
            Lodges page. Pictures are stored on this server.
          </p>
        </div>
        <ImageManagerClient />
      </div>
    </ConsoleShell>
  );
}
