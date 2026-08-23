import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { publicBaseUrl } from "@/lib/env";
import { listPostsForAdmin, parseTab } from "@/lib/post-admin";
import { parseLimit, serializePostForAdmin } from "@/lib/posts";

/**
 * GET /api/admin/posts — the moderation list.
 *
 * `?tab=hidden|flagged|all` (default hidden, which is the working queue),
 * `?q=` over content and author name, `?clubId=`, `?limit=`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rows = await listPostsForAdmin({
    tab: parseTab(url.searchParams.get("tab")),
    q: url.searchParams.get("q")?.trim() || undefined,
    clubId: url.searchParams.get("clubId")?.trim() || undefined,
    limit: parseLimit(url.searchParams.get("limit"), LIMIT_DEFAULT, LIMIT_MAX),
  });

  const baseUrl = publicBaseUrl(req);
  return NextResponse.json({
    posts: rows.map((row) => ({
      ...serializePostForAdmin(row.post, baseUrl),
      breakdown: row.breakdown,
      reportingClubs: row.reportingClubs,
      notes: row.notes,
    })),
    count: rows.length,
  });
}
