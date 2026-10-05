import { NextResponse } from "next/server";

import { enforceClientApiVersion } from "@/lib/api-version-gate";
import { authenticateApiRequest, clientIp, hasScope } from "@/lib/api-auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { derivePushSecret } from "@/lib/push-delivery";
import { PushTargetError, validatePushTarget } from "@/lib/push-targets";

function rateLimited(resetAt: number) {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": String(
          Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
        ),
      },
    },
  );
}

/**
 * Where this club wants shared posts pushed to.
 *
 * PUT registers or replaces the target and returns the signing secret the club
 * must verify pushes with. DELETE withdraws it, after which the club receives
 * posts only by polling `/api/v1/feed/sync` — which it should be doing anyway,
 * since push is the fast path and polling is the guarantee.
 *
 * A club may only ever set its OWN target: the club comes from the token, and
 * there is no field in the body that could name a different one. That is
 * deliberate — a body-supplied club id would let one club redirect another's
 * posts to a host it controls.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // A club on a different API version transfers nothing (see api-version-gate).
  const versionRefusal = await enforceClientApiVersion(req, auth.client);
  if (versionRefusal) return versionRefusal;
  const { club, token } = auth.client;

  // Each PUT resolves the target's address and writes the club row, so it is
  // limited per token like every other data route.
  const rl = checkRateLimit(`push-target:${token.id}`);
  if (!rl.allowed) return rateLimited(rl.resetAt);

  // Registering a delivery destination is a write to how this club receives
  // content, so it takes the same scope as writing posts rather than a read
  // scope.
  if (!hasScope(token, "posts:write")) {
    return NextResponse.json(
      { error: "Token lacks posts:write scope" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const raw = (body as { url?: unknown })?.url;
  if (typeof raw !== "string") {
    return NextResponse.json(
      { error: "Provide the URL to push to as `url`." },
      { status: 400 },
    );
  }

  let url: string;
  try {
    // Shape AND resolution. The address is checked again before every delivery,
    // because DNS can be repointed after registration.
    url = await validatePushTarget(raw);
  } catch (error) {
    if (error instanceof PushTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // A CHANGE OF DESTINATION ROTATES THE SECRET. Without that, a club that had
  // once registered a target keeps a working signing key for whatever it points
  // at next — including, if the club's own key ever leaked, a host somebody
  // else controls.
  const current = await prisma.club.findUnique({
    where: { id: club.id },
    select: { pushUrl: true, pushSecretVersion: true },
  });
  const rotate = current?.pushUrl !== url;
  const version = (current?.pushSecretVersion ?? 1) + (rotate ? 1 : 0);

  await prisma.club.update({
    where: { id: club.id },
    data: { pushUrl: url, pushEnabled: true, pushSecretVersion: version },
  });

  await recordAudit({
    action: "push_target.set",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
    // The host, not the whole URL: a path can carry a token, and an audit row
    // is read by more people than the club that wrote it.
    metadata: { host: new URL(url).host, rotated: rotate, version },
  });

  return NextResponse.json({
    url,
    secretVersion: version,
    // Returned on every successful registration rather than once: the club
    // authenticated with its own API key to get here, and a secret it cannot
    // re-read is a secret that strands the integration the first time the club
    // redeploys without its configuration.
    secret: derivePushSecret(club.id, version),
    signature: {
      header: "X-Acs-Signature",
      timestampHeader: "X-Acs-Timestamp",
      algorithm: "HMAC-SHA256 over `${timestamp}.${body}`",
    },
  });
}

export async function DELETE(req: Request) {
  const ip = clientIp(req);
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // A club on a different API version transfers nothing (see api-version-gate).
  const versionRefusal = await enforceClientApiVersion(req, auth.client);
  if (versionRefusal) return versionRefusal;
  const { club, token } = auth.client;

  const rl = checkRateLimit(`push-target:${token.id}`);
  if (!rl.allowed) return rateLimited(rl.resetAt);

  if (!hasScope(token, "posts:write")) {
    return NextResponse.json(
      { error: "Token lacks posts:write scope" },
      { status: 403 },
    );
  }

  await prisma.club.update({
    where: { id: club.id },
    // The URL is cleared as well as disabled. Leaving it behind would mean a
    // later `pushEnabled` flip silently resumed delivery to a destination
    // nobody had re-confirmed.
    data: { pushUrl: null, pushEnabled: false },
  });

  await recordAudit({
    action: "push_target.cleared",
    clubId: club.id,
    tokenId: token.id,
    ipAddress: ip,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ cleared: true });
}
