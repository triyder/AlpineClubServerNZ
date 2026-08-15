import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ConsoleShell } from "@/components/console-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [pending, approved, rejected, tokenCount, recentAudits] =
    await Promise.all([
      prisma.club.count({ where: { status: "PENDING" } }),
      prisma.club.count({ where: { status: "APPROVED" } }),
      prisma.club.count({ where: { status: "REJECTED" } }),
      prisma.apiToken.count({ where: { revokedAt: null } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { club: true },
      }),
    ]);

  const stats = [
    { label: "Pending applications", value: pending },
    { label: "Approved clubs", value: approved },
    { label: "Rejected", value: rejected },
    { label: "Active API tokens", value: tokenCount },
  ];

  return (
    <ConsoleShell session={session}>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of connected clubs and recent client activity.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="pb-2">
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="text-3xl">{s.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Latest connections and requests from client applications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentAudits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {recentAudits.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          a.outcome === "SUCCESS" ? "secondary" : "destructive"
                        }
                      >
                        {a.action}
                      </Badge>
                      {a.club ? (
                        <span className="text-muted-foreground">
                          {a.club.name}
                        </span>
                      ) : null}
                    </div>
                    <time className="text-muted-foreground">
                      {a.createdAt.toISOString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </ConsoleShell>
  );
}
