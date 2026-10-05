import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { clubApiVersionStatus } from "@/lib/club-api-version";

/** `2026-10-04 12:03 UTC` — the audit screen's style, to the minute. */
function stamp(date: Date): string {
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * A club's last reported API version, beside what that means: can it sync, and
 * who has to act. Presentational only — no data access, so the Clubs page passes
 * in what it already loaded.
 */
export function ClubApiVersion({
  reported,
  checkedAt,
  serverVersion,
}: {
  reported: string | null;
  checkedAt: Date | null;
  /** Defaults to this server's version; a parameter so it can be tested. */
  serverVersion?: string;
}) {
  const status = clubApiVersionStatus(reported, serverVersion);

  const badge =
    status.state === "matches" ? (
      <Badge variant="success">Version {status.reported} · up to date</Badge>
    ) : status.state === "behind" ? (
      <Badge variant="destructive">Version {status.reported} · behind</Badge>
    ) : status.state === "ahead" ? (
      <Badge variant="warning">Version {status.reported} · newer than this server</Badge>
    ) : (
      <Badge variant="secondary">Version not reported</Badge>
    );

  return (
    <div className="space-y-1" data-testid="club-api-version">
      <p className="text-sm font-medium">API version</p>
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        {checkedAt ? (
          <span className="text-xs text-muted-foreground">
            last checked {stamp(checkedAt)}
          </span>
        ) : null}
      </div>
      {status.state === "behind" ? (
        <p className="text-xs text-muted-foreground">
          This server is on {status.serverVersion}, so nothing is transferred
          until this club&apos;s site is upgraded.{" "}
          <Link href="/issues" className="underline">
            See Issues
          </Link>
        </p>
      ) : null}
      {status.state === "ahead" ? (
        <p className="text-xs text-muted-foreground">
          This club&apos;s site is newer than this server ({status.serverVersion}),
          so nothing is transferred until the server is upgraded.{" "}
          <Link href="/issues" className="underline">
            See Issues
          </Link>
        </p>
      ) : null}
      {status.state === "unreported" ? (
        <p className="text-xs text-muted-foreground">
          This club has not told the server which version it runs: older software
          than the version check, or it has not checked in since it was upgraded.
          It is not refused, but it is not confirmed up to date either.
        </p>
      ) : null}
    </div>
  );
}
