import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ConsoleShell } from "@/components/console-shell";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      email: true,
      role: true,
      createdAt: true,
      passwordChangedAt: true,
    },
  });
  if (!user) redirect("/login");

  return (
    <ConsoleShell session={session}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">Manage your account and preferences.</p>
        </div>

        {/* Account information */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Account information</CardTitle>
                <CardDescription>Your sign-in identity and role.</CardDescription>
              </div>
              <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                {user.role}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user.email}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-muted-foreground">Member since</span>
              <span className="font-medium">
                {user.createdAt.toISOString().slice(0, 10)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Security / change password */}
        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>
              {user.passwordChangedAt
                ? `Password last changed ${user.passwordChangedAt
                    .toISOString()
                    .slice(0, 10)}.`
                : "Your password has not been changed since the account was created."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        {/* Appearance / theme */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Choose a light or dark theme, or follow your system setting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSwitcher className="max-w-sm" />
          </CardContent>
        </Card>

        {/* Session */}
        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out of the oversight console.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/logout" method="post">
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ConsoleShell>
  );
}
