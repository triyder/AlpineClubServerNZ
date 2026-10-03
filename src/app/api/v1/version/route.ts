import { NextResponse } from "next/server";
import { authenticateApiRequest, clientIp } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  SERVER_API_VERSION,
  apiVersionsMatch,
  readClientApiVersion,
} from "@/lib/api-version";
import {
  auditVersionMismatch,
  recordVersionMismatch,
  stampReportedVersion,
} from "@/lib/sync-issues";

/**
 * GET /api/v1/version — the server's API version, for a club to compare with the
 * version it was built for.
 *
 * Authenticated with the club's own token (any approved club, no scope): the
 * audit log and the Issues screen need to know WHICH club asked, and a club with
 * no API key is not supposed to be calling at all.
 *
 * Always answers 200 with the server's number, even on a mismatch — the club
 * needs the number to show it, and a 409 here would hide the very thing it asked
 * for. The club passes its own version in `X-Client-Api-Version` (or
 * `?clientVersion=`); when it differs the check is audited as a failure and an
 * issue is opened or refreshed.
 */
export async function GET(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { club, token } = auth.client;

  const rl = checkRateLimit(`version:${token.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(0, Math.ceil((rl.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const declared = readClientApiVersion(req);
  if (declared === undefined) {
    return NextResponse.json(
      {
        error: "Invalid client API version",
        code: "API_VERSION_INVALID",
        version: SERVER_API_VERSION,
      },
      { status: 400 },
    );
  }

  const match =
    declared === null ? null : apiVersionsMatch(declared, SERVER_API_VERSION);

  if (declared !== null) {
    await stampReportedVersion(club, declared, { force: true });
  }

  await recordAudit({
    action: "api.version.check",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    metadata: {
      clientVersion: declared,
      serverVersion: SERVER_API_VERSION,
      match,
    },
  });

  if (match === false) {
    await recordVersionMismatch({ clubId: club.id, clientVersion: declared });
    await auditVersionMismatch({
      clubId: club.id,
      tokenId: token.id,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
      clientVersion: declared,
      path: new URL(req.url).pathname,
    });
  }

  return NextResponse.json({ version: SERVER_API_VERSION, match });
}
