import { redirect } from "next/navigation";
import Link from "next/link";
import type { AuditOutcome, Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ConsoleShell } from "@/components/console-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; outcome?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  // The audit trail is sensitive; restrict to ADMIN / MANAGER.
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const actionFilter = params.action?.trim() || undefined;
  const outcomeFilter: AuditOutcome | undefined =
    params.outcome === "SUCCESS" || params.outcome === "FAILURE"
      ? params.outcome
      : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(outcomeFilter ? { outcome: outcomeFilter } : {}),
  };

  const [total, entries, distinctActions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        club: { select: { name: true, code: true } },
        token: { select: { name: true, tokenPrefix: true } },
      },
    }),
    // Distinct action names for the filter chips.
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function href(next: Partial<{ action: string; outcome: string; page: number }>) {
    const sp = new URLSearchParams();
    const a = next.action ?? actionFilter;
    const o = next.outcome ?? outcomeFilter;
    if (a) sp.set("action", a);
    if (o) sp.set("outcome", o);
    if (next.page && next.page > 1) sp.set("page", String(next.page));
    const q = sp.toString();
    return q ? `/audit?${q}` : "/audit";
  }

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
          <p className="text-muted-foreground">
            All activity in and out of the central server — client connections,
            uploads, pulls, and admin actions.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Activity</CardTitle>
                <CardDescription>
                  {total} event{total === 1 ? "" : "s"}
                  {actionFilter ? ` · action: ${actionFilter}` : ""}
                  {outcomeFilter ? ` · ${outcomeFilter.toLowerCase()}` : ""}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                <Link
                  href={href({ action: "" })}
                  className="rounded border border-border px-2 py-1 hover:bg-accent"
                >
                  All actions
                </Link>
                {distinctActions.map((a) => (
                  <Link
                    key={a.action}
                    href={href({ action: a.action, page: 1 })}
                    className={`rounded border border-border px-2 py-1 hover:bg-accent ${
                      a.action === actionFilter ? "bg-accent" : ""
                    }`}
                  >
                    {a.action}
                  </Link>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time (UTC)</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Club</TableHead>
                      <TableHead>Token</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                        </TableCell>
                        <TableCell className="font-medium">{e.action}</TableCell>
                        <TableCell>
                          <Badge
                            variant={e.outcome === "SUCCESS" ? "secondary" : "destructive"}
                          >
                            {e.outcome}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.club ? e.club.name : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {e.token ? e.token.tokenPrefix : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {e.ipAddress ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                          {e.metadata ? JSON.stringify(e.metadata) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link
                      href={href({ page: page - 1 })}
                      className="rounded border border-border px-3 py-1 hover:bg-accent"
                    >
                      Previous
                    </Link>
                  ) : null}
                  {page < totalPages ? (
                    <Link
                      href={href({ page: page + 1 })}
                      className="rounded border border-border px-3 py-1 hover:bg-accent"
                    >
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ConsoleShell>
  );
}
