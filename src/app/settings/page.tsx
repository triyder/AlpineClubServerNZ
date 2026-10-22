import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ConsoleShell } from "@/components/console-shell";
import { PortalSettingsPanel } from "@/components/portal-settings-panel";
import { loadPostSettings } from "@/lib/settings";
import { loadMailSettings } from "@/lib/mail";
import { EmailSettingsPanel } from "@/components/email-settings-panel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // These settings govern how long member content lives and how easily it is
  // hidden across every connected club, so ADMIN only - and checked here, not
  // just in the Edge proxy, which only verifies the JWT signature.
  if (session.role !== "ADMIN") redirect("/dashboard");

  const [settings, mail] = await Promise.all([loadPostSettings(), loadMailSettings()]);

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Retention and moderation thresholds for the cross-club message board,
            and the mail server this console sends through.
          </p>
        </div>
        <PortalSettingsPanel initial={settings} />
        <EmailSettingsPanel initial={mail} adminEmail={session.email} />
      </div>
    </ConsoleShell>
  );
}
