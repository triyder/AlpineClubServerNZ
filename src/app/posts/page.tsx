import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { ConsoleShell } from "@/components/console-shell";
import { PostsPanel, type AdminPostRow } from "@/components/posts-panel";
import { listPostsForAdmin, parseTab } from "@/lib/post-admin";
import { serializePostForAdmin } from "@/lib/posts";
import { publicBaseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The moderation queue is queried here, in the server component, rather than
 * fetched from the client on mount. The tab and search live in the URL, so
 * switching either is an ordinary navigation — which means no loading effect,
 * no client-side data cascade, and a shareable link to a filtered queue.
 */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // The proxy is an Edge-runtime JWT check only, so the real authorisation
  // decision is made here and in every /api/admin route.
  if (session.role !== "ADMIN") redirect("/dashboard");

  const params = await searchParams;
  const tab = parseTab(params.tab ?? null);
  const q = params.q?.trim() || undefined;

  const rows = await listPostsForAdmin({ tab, q, limit: 50 });

  // publicBaseUrl needs the proxy headers to build absolute image URLs; in a
  // server component they come from headers() rather than a Request.
  const headerList = await headers();
  const baseUrl = publicBaseUrl(
    new Request("https://placeholder.invalid", { headers: headerList }),
  );

  const posts: AdminPostRow[] = rows.map((row) => ({
    ...serializePostForAdmin(row.post, baseUrl),
    breakdown: row.breakdown,
    reportingClubs: row.reportingClubs,
    notes: row.notes,
  }));

  return (
    <ConsoleShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Posts</h1>
          <p className="text-muted-foreground">
            Moderation for the cross-club message board. Only posts a club chose
            to share with the network appear here — club-only posts never leave
            the club that wrote them.
          </p>
        </div>
        <PostsPanel posts={posts} tab={tab} query={q ?? ""} />
      </div>
    </ConsoleShell>
  );
}
