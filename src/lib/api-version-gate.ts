import "server-only";
import { NextResponse } from "next/server";
import { clientIp, type AuthenticatedClient } from "@/lib/api-auth";
import {
  SERVER_API_VERSION,
  apiVersionsMatch,
  describeDeclaredVersion,
  invalidClientApiVersionBody,
  readClientApiVersion,
  readRawClientApiVersion,
} from "@/lib/api-version";
import {
  allowVersionRecording,
  auditInvalidVersion,
  auditVersionMismatch,
  recordVersionMismatch,
  stampReportedVersion,
} from "@/lib/sync-issues";

/**
 * The version gate every data-moving `/api/v1` route runs straight after
 * authentication: a club that declares an API version other than this server's
 * transfers nothing.
 *
 * A request with NO version header is not refused. Software older than the
 * version check cannot send one, and refusing it would take the network down on
 * deploy; such a club is caught the moment it is upgraded and checks.
 *
 * The refusals run BEFORE any route's own rate limiter, so what they write
 * (the club stamp, the issue, the audit row) is bounded here, per token, by
 * `allowVersionRecording`. Over that allowance the request is still refused
 * with the same status; only the recording is skipped.
 *
 * Returns the response to send, or `null` to carry on. Kept in one place so a
 * route cannot decide the rule differently from the others.
 */
export async function enforceClientApiVersion(
  req: Request,
  client: AuthenticatedClient,
): Promise<NextResponse | null> {
  const declared = readClientApiVersion(req);
  if (declared === null) return null;

  if (declared === undefined) {
    if (allowVersionRecording(client.token.id)) {
      await auditInvalidVersion({
        clubId: client.club.id,
        tokenId: client.token.id,
        ipAddress: clientIp(req),
        userAgent: req.headers.get("user-agent"),
        declared: describeDeclaredVersion(readRawClientApiVersion(req) ?? ""),
        path: new URL(req.url).pathname,
      });
    }
    return NextResponse.json(invalidClientApiVersionBody(), { status: 400 });
  }

  if (apiVersionsMatch(declared, SERVER_API_VERSION)) {
    await stampReportedVersion(client.club, declared);
    return null;
  }

  if (allowVersionRecording(client.token.id)) {
    await stampReportedVersion(client.club, declared);
    await recordVersionMismatch({ clubId: client.club.id, clientVersion: declared });
    await auditVersionMismatch({
      clubId: client.club.id,
      tokenId: client.token.id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      clientVersion: declared,
      path: new URL(req.url).pathname,
    });
  }
  return NextResponse.json(
    {
      error:
        "This server is on a different API version, so nothing is transferred until your site is upgraded.",
      code: "API_VERSION_MISMATCH",
      serverVersion: SERVER_API_VERSION,
      clientVersion: declared,
    },
    { status: 409 },
  );
}
