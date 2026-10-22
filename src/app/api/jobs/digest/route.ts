import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jobSecret } from "@/lib/env";
import { runAdminDigest } from "@/lib/admin-digest";
import { logger } from "@/lib/logger";

/**
 * POST /api/jobs/digest — send the administrator's digest (#34).
 *
 * Called by the HOST's cron (decided on the issue: no in-app scheduler), and
 * by an operator by hand to test. Authenticated by `x-job-secret` matching
 * `JOB_SECRET`, compared in constant time; no session, no API token. The run
 * is idempotent by its watermark, so calling it twice sends once, and a
 * second call while one is running answers 409 rather than racing it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function presentedSecretMatches(req: Request): boolean {
  const expected = jobSecret();
  const presented = req.headers.get("x-job-secret") ?? "";
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!presentedSecretMatches(req)) {
    // The same answer whether JOB_SECRET is unset, wrong or missing from the
    // request: nothing about the server's configuration is revealed.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAdminDigest();
    if (!result.ran) {
      return NextResponse.json({ error: "A digest run is already in progress" }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (err) {
    // A failed send leaves the watermark where it was; the next run covers
    // the same period again. Report the provider's words to the operator.
    logger.error({ err }, "admin digest run failed");
    const message = err instanceof Error ? err.message : "Digest run failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
