import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ConsoleShell } from "@/components/console-shell";
import { approveFromReviewAction, rejectFromReviewAction } from "../../actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** `2026-10-04 12:03 UTC` — the audit screen's style, to the minute. */
function stamp(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * One club's connection request: the page a new-club email links to.
 *
 * Opening it changes nothing — mail scanners fetch links — and it sits under
 * `/clubs`, so the proxy sends a signed-out visitor to sign in and back. The
 * buttons are the same guarded review as the Connections page (PENDING only),
 * so an old email opened after someone else decided shows that decision.
 */
export default async function ClubReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = session.role === "ADMIN" || session.role === "MANAGER";

  const { id } = await params;
  const club = await prisma.club.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      contactEmail: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      reviewedBy: { select: { email: true } },
      requestedLodgeIds: true,
      registrationNotes: true,
    },
  });
  if (!club) notFound();

  const requested =
    club.requestedLodgeIds.length === 0
      ? []
      : await prisma.otherLodge.findMany({
          where: { id: { in: club.requestedLodgeIds } },
          select: { id: true, name: true, sourceClubId: true, sourceClub: { select: { name: true } } },
          orderBy: { name: "asc" },
        });

  return (
    <ConsoleShell session={session}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connection request</h1>
          <p className="text-muted-foreground">
            <Link href="/clubs" className="underline underline-offset-4">
              All connections
            </Link>
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {club.name}
                  <span className="font-mono text-xs text-muted-foreground">{club.code}</span>
                </CardTitle>
                <CardDescription>
                  {club.location ? `${club.location} · ` : ""}
                  {club.contactEmail}
                </CardDescription>
              </div>
              <Badge
                variant={
                  club.status === "APPROVED"
                    ? "success"
                    : club.status === "PENDING"
                      ? "warning"
                      : "destructive"
                }
              >
                {club.status.charAt(0) + club.status.slice(1).toLowerCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">Registered {stamp(club.createdAt)}</p>

            <div className="space-y-1">
              <p className="font-medium">Lodges requested</p>
              {requested.length === 0 ? (
                <p className="text-muted-foreground">None</p>
              ) : (
                <ul className="list-disc pl-5">
                  {requested.map((l) => (
                    <li key={l.id}>
                      {l.name}
                      {l.sourceClubId && l.sourceClubId !== club.id ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — now held by {l.sourceClub?.name ?? "another club"}, so it will be skipped
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {club.registrationNotes ? (
              <p className="whitespace-pre-line">
                <span className="font-medium">Note:</span> {club.registrationNotes}
              </p>
            ) : null}

            {club.status === "PENDING" ? (
              canManage ? (
                <div className="flex gap-2 pt-2">
                  <form action={approveFromReviewAction}>
                    <input type="hidden" name="clubId" value={club.id} />
                    <Button type="submit">Approve</Button>
                  </form>
                  <form action={rejectFromReviewAction}>
                    <input type="hidden" name="clubId" value={club.id} />
                    <Button type="submit" variant="outline">
                      Reject
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Only an administrator or manager can approve this request.
                </p>
              )
            ) : (
              <p className="text-muted-foreground">
                {club.status === "APPROVED" ? "Approved" : club.status === "REJECTED" ? "Rejected" : "Suspended"}
                {club.reviewedAt ? ` ${stamp(club.reviewedAt)}` : ""}
                {club.reviewedBy ? ` by ${club.reviewedBy.email}` : ""}.{" "}
                {club.status === "APPROVED" ? (
                  <>
                    Issue or manage its keys on{" "}
                    <Link href="/clubs" className="underline underline-offset-4">
                      Connections
                    </Link>
                    .
                  </>
                ) : null}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ConsoleShell>
  );
}
