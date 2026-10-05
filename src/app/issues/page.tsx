import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ConsoleShell } from "@/components/console-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { SERVER_API_VERSION, apiVersionsMatch } from "@/lib/api-version";
import { VERSION_MISMATCH_KIND } from "@/lib/sync-issues";
import { clearIssueAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  [VERSION_MISMATCH_KIND]: "Version mismatch",
};

function stamp(date: Date | null): string {
  return date ? date.toISOString().replace("T", " ").slice(0, 19) : "—";
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  // Same tier as reviewing clubs: ADMIN / MANAGER.
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const showCleared = params.status === "cleared";

  const issues = await prisma.syncIssue.findMany({
    where: { status: showCleared ? "CLEARED" : "OPEN" },
    orderBy: showCleared ? { clearedAt: "desc" } : { lastSeenAt: "desc" },
    include: {
      club: {
        select: {
          name: true,
          code: true,
          lastReportedApiVersion: true,
          lastVersionCheckAt: true,
          submittedOtherLodges: {
            select: { name: true },
            orderBy: { name: "asc" },
          },
        },
      },
      clearedBy: { select: { email: true } },
    },
  });

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Issues</h1>
          <p className="text-muted-foreground">
            Conditions that need a person to look at them. An issue stays here
            until it is flagged as cleared, even when the club has since caught
            up. This server is on API version {SERVER_API_VERSION}.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{showCleared ? "Cleared issues" : "Open issues"}</CardTitle>
                <CardDescription>
                  {issues.length} {showCleared ? "cleared" : "open"}
                </CardDescription>
              </div>
              <div className="flex gap-1 text-xs">
                <Link
                  href="/issues"
                  aria-current={showCleared ? undefined : "page"}
                  className={`rounded border border-border px-2 py-1 hover:bg-accent ${
                    showCleared ? "" : "bg-accent"
                  }`}
                >
                  Open
                </Link>
                <Link
                  href="/issues?status=cleared"
                  aria-current={showCleared ? "page" : undefined}
                  className={`rounded border border-border px-2 py-1 hover:bg-accent ${
                    showCleared ? "bg-accent" : ""
                  }`}
                >
                  Cleared
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {showCleared ? "No cleared issues." : "No open issues."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Issue</TableHead>
                      <TableHead>Club</TableHead>
                      <TableHead>Lodges</TableHead>
                      <TableHead>Club version</TableHead>
                      <TableHead>Server version</TableHead>
                      <TableHead>First seen (UTC)</TableHead>
                      <TableHead>Last seen (UTC)</TableHead>
                      <TableHead className="text-right">Times</TableHead>
                      <TableHead>
                        {showCleared ? "Cleared" : "Action"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.map((issue) => {
                      const nowMatches =
                        issue.kind === VERSION_MISMATCH_KIND &&
                        apiVersionsMatch(
                          issue.club.lastReportedApiVersion,
                          SERVER_API_VERSION,
                        );
                      return (
                        <TableRow key={issue.id}>
                          <TableCell className="font-medium">
                            {KIND_LABELS[issue.kind] ?? issue.kind}
                          </TableCell>
                          <TableCell>
                            {issue.club.name}
                            <div className="text-xs text-muted-foreground">
                              {issue.club.code}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground">
                            {issue.club.submittedOtherLodges.length > 0
                              ? issue.club.submittedOtherLodges
                                  .map((l) => l.name)
                                  .join(", ")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive">
                              {issue.clientVersion ?? "unknown"}
                            </Badge>
                          </TableCell>
                          <TableCell>{issue.serverVersion}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {stamp(issue.firstSeenAt)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {stamp(issue.lastSeenAt)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {issue.occurrences}
                          </TableCell>
                          <TableCell>
                            {showCleared ? (
                              <div className="text-xs text-muted-foreground">
                                {stamp(issue.clearedAt)}
                                <div>{issue.clearedBy?.email ?? "—"}</div>
                                {issue.note ? <div>{issue.note}</div> : null}
                              </div>
                            ) : (
                              <form
                                action={clearIssueAction}
                                className="flex flex-col gap-1"
                              >
                                <input
                                  type="hidden"
                                  name="issueId"
                                  value={issue.id}
                                />
                                {nowMatches ? (
                                  <span className="text-xs text-green-700 dark:text-green-400">
                                    Club now reports {SERVER_API_VERSION} —
                                    ready to clear
                                  </span>
                                ) : null}
                                <input
                                  name="note"
                                  maxLength={500}
                                  placeholder="Note (optional)"
                                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                                />
                                <Button size="sm" variant="outline" type="submit">
                                  Mark cleared
                                </Button>
                              </form>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ConsoleShell>
  );
}
