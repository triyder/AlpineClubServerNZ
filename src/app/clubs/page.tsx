import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ConsoleShell } from "@/components/console-shell";
import { TokenGenerator } from "@/components/token-generator";
import {
  approveClubAction,
  rejectClubAction,
  revokeTokenAction,
} from "./actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClubStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function statusBadge(status: ClubStatus) {
  switch (status) {
    case "APPROVED":
      return <Badge variant="success">Approved</Badge>;
    case "REJECTED":
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge variant="warning">Pending</Badge>;
  }
}

export default async function ClubsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = session.role === "ADMIN" || session.role === "MANAGER";

  const clubs = await prisma.club.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      apiTokens: { orderBy: { createdAt: "desc" } },
    },
  });

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clubs &amp; lodges</h1>
          <p className="text-muted-foreground">
            Review link applications, approve or reject, and issue API keys.
          </p>
        </div>

        {clubs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No clubs have registered yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {clubs.map((club) => (
              <Card key={club.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {club.name}
                        <span className="font-mono text-xs text-muted-foreground">
                          {club.code}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        {club.location ? `${club.location} · ` : ""}
                        {club.contactEmail}
                      </CardDescription>
                    </div>
                    {statusBadge(club.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {canManage && club.status === "PENDING" ? (
                    <div className="flex gap-2">
                      <form action={approveClubAction}>
                        <input type="hidden" name="clubId" value={club.id} />
                        <Button size="sm" type="submit">
                          Approve
                        </Button>
                      </form>
                      <form action={rejectClubAction}>
                        <input type="hidden" name="clubId" value={club.id} />
                        <Button size="sm" variant="outline" type="submit">
                          Reject
                        </Button>
                      </form>
                    </div>
                  ) : null}

                  {club.status === "APPROVED" ? (
                    <div className="space-y-3">
                      {canManage ? <TokenGenerator clubId={club.id} /> : null}

                      {club.apiTokens.length > 0 ? (
                        <ul className="divide-y divide-border text-sm">
                          {club.apiTokens.map((t) => (
                            <li
                              key={t.id}
                              className="flex items-center justify-between gap-4 py-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{t.name}</span>
                                <code className="text-xs text-muted-foreground">
                                  {t.tokenPrefix}…
                                </code>
                                {t.revokedAt ? (
                                  <Badge variant="destructive">Revoked</Badge>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground">
                                  {t.lastUsedAt
                                    ? `last used ${t.lastUsedAt.toISOString().slice(0, 10)}`
                                    : "never used"}
                                </span>
                                {canManage && !t.revokedAt ? (
                                  <form action={revokeTokenAction}>
                                    <input
                                      type="hidden"
                                      name="tokenId"
                                      value={t.id}
                                    />
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      type="submit"
                                    >
                                      Revoke
                                    </Button>
                                  </form>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No API keys issued yet.
                        </p>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ConsoleShell>
  );
}
