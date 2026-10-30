import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { liveOtherLodgeWhere } from "@/lib/other-lodges";
import { ConsoleShell } from "@/components/console-shell";
import { TokenGenerator } from "@/components/token-generator";
import { ClubApiVersion } from "@/components/club-api-version";
import {
  ClubLodgesSelect,
  type ClubLodgeOption,
} from "@/components/club-lodges-select";
import {
  approveClubAction,
  rejectClubAction,
  suspendClubAction,
  reapproveClubAction,
  revokeTokenAction,
  deleteRevokedTokenAction,
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
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import type { ClubStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

function statusBadge(status: ClubStatus) {
  switch (status) {
    case "APPROVED":
      return <Badge variant="success">Approved</Badge>;
    case "REJECTED":
      return <Badge variant="destructive">Rejected</Badge>;
    case "SUSPENDED":
      return <Badge variant="destructive">Unapproved</Badge>;
    default:
      return <Badge variant="warning">Pending</Badge>;
  }
}

export default async function ClubsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canManage = session.role === "ADMIN" || session.role === "MANAGER";

  const [clubs, lodges] = await Promise.all([
    prisma.club.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        apiTokens: { orderBy: { createdAt: "desc" } },
      },
    }),
    // Every lodge with its owner, so each club's chooser can offer the free ones
    // and show who holds the rest.
    // Live lodges only (#16): a deleted lodge is no longer given to any club.
    prisma.otherLodge.findMany({
      where: liveOtherLodgeWhere,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        sourceClubId: true,
        sourceClub: { select: { name: true } },
      },
    }),
  ]);
  const lodgeOptions: ClubLodgeOption[] = lodges.map((l) => ({
    id: l.id,
    name: l.name,
    ownerClubId: l.sourceClubId,
    ownerClubName: l.sourceClub?.name ?? null,
  }));

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
            <p className="text-muted-foreground">
              The clubs linked to this server: review link applications, approve
              or reject, and issue API keys.
            </p>
          </div>
          {/* Registering a lodge is an administrator's action (#32): it lives
              here, first, rather than in the guest header. */}
          <Button asChild variant="outline">
            <Link href="/register">Register a lodge</Link>
          </Button>
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
              <Card key={club.id} id={`club-${club.id}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-4">
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
                    {/* The status and API version share the top-right corner, so
                        the panel spends no rows of its own on them. */}
                    <div className="flex flex-col gap-2 sm:items-end">
                      {statusBadge(club.status)}
                      {club.status === "APPROVED" ? (
                        <ClubApiVersion
                          reported={club.lastReportedApiVersion}
                          checkedAt={club.lastVersionCheckAt}
                          align="end"
                        />
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {club.status === "APPROVED" ? (
                    <ClubLodgesSelect
                      // Re-keyed on the saved list so a save (which refreshes this
                      // page) remounts the component: that resets its
                      // unsaved-changes state, and the refreshed chips are the
                      // confirmation — it shows no "Saved" message of its own.
                      key={`${club.id}:${lodgeOptions
                        .filter((l) => l.ownerClubId === club.id)
                        .map((l) => l.id)
                        .join(",")}`}
                      clubId={club.id}
                      options={lodgeOptions}
                      initialSelectedIds={lodgeOptions
                        .filter((l) => l.ownerClubId === club.id)
                        .map((l) => l.id)}
                      canManage={canManage}
                    />
                  ) : null}

                  {club.status === "SUSPENDED" ? (
                    <div className="space-y-2 text-sm">
                      <p className="text-muted-foreground">
                        Unapproved: its key is refused, and nothing is sent to it or
                        asked of it. Its lodges and keys are kept for a re-approval.
                      </p>
                      <p>
                        <span className="font-medium">Lodges held:</span>{" "}
                        {lodgeOptions
                          .filter((l) => l.ownerClubId === club.id)
                          .map((l) => l.name)
                          .join(", ") || "none"}
                      </p>
                      {canManage ? (
                        <form action={reapproveClubAction}>
                          <input type="hidden" name="clubId" value={club.id} />
                          <Button size="sm" type="submit">
                            Re-approve
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}

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

                  {/* #40: what the club asked for when it registered. Shown
                      while pending (the approval assigns it) and kept afterwards
                      as the record of the request. */}
                  {club.requestedLodgeIds.length > 0 || club.registrationNotes ? (
                    <div className="space-y-1 text-sm">
                      {club.requestedLodgeIds.length > 0 ? (
                        <p>
                          <span className="font-medium">Lodges requested at registration:</span>{" "}
                          {club.requestedLodgeIds
                            .map((id) => lodgeOptions.find((l) => l.id === id)?.name ?? "(a lodge since removed)")
                            .join(", ")}
                        </p>
                      ) : null}
                      {club.registrationNotes ? (
                        <p className="whitespace-pre-line text-muted-foreground">
                          <span className="font-medium text-foreground">Note:</span> {club.registrationNotes}
                        </p>
                      ) : null}
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
                                {canManage && t.revokedAt ? (
                                  <form action={deleteRevokedTokenAction}>
                                    <input
                                      type="hidden"
                                      name="tokenId"
                                      value={t.id}
                                    />
                                    <ConfirmSubmitButton
                                      size="sm"
                                      variant="ghost"
                                      message={`Delete the revoked key ${t.tokenPrefix}… for good? Its audit history is kept; the row is not.`}
                                    >
                                      Delete
                                    </ConfirmSubmitButton>
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

                      {canManage ? (
                        <form action={suspendClubAction} className="border-t border-border pt-3">
                          <input type="hidden" name="clubId" value={club.id} />
                          <ConfirmSubmitButton
                            size="sm"
                            variant="outline"
                            message={`Unapprove ${club.name}? Its key stops working at once and nothing more is sent to it. You can re-approve it later.`}
                          >
                            Unapprove
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
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
