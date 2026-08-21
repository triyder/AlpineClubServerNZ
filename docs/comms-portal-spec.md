# Communication Portal — implementation spec

**Status:** decisions settled, ready to build · **Rev B** · 22 Aug 2026
**Supersedes:** the original "multi-club Communication Portal" brief
**Migration:** `0004_posts`
**Rendered copy:** https://claude.ai/code/artifact/5a28de3b-4d65-44a6-ae57-c1648f800c24

A cross-club member feed with image posts, member reporting, and central
moderation. The original brief assumed a Node/Express stack that this
repository does not run; this document rewrites it against Next.js 16 App
Router + Prisma 7 + PostgreSQL 16, following the conventions already
established in `src/lib`.

---

## 1. What changed from the original brief

The brief assumed Node/Express, UUID keys, an `X-Club-API-Key` header,
`express.static` serving from `public/`, and a Super Admin role. None of those
exist here.

| Brief said | This spec says | Because |
| --- | --- | --- |
| Express routes + `express.static` | App Router route handlers; images streamed by a handler | No Express in the repo. Next only serves `public/` content present at build time. |
| Save to `public/uploads/posts/` | Write to `UPLOADS_DIR` on a named Docker volume | The Dockerfile bakes `public/` into the image — runtime writes vanish on rebuild. |
| `X-Club-API-Key` header | Existing `authenticateApiRequest()` + `posts:*` scopes | Auth, revocation, club approval and `lastUsedAt` are already solved in `api-auth.ts`. |
| "Server Super Admins" | `requireAdmin()` — the `ADMIN` role, everywhere | There is no Super Admin. ADMIN is the only role this server uses. |
| UUID primary keys | `@default(cuid())` | Every existing model uses cuid. |
| `is_hidden` / `is_deleted` booleans | `hiddenAt` / `deletedAt` timestamps + `hiddenBy` | A moderation queue needs to know *when* and *by whom*, not just whether. |
| Auto-hide at 5 reports | Auto-hide at **3**, plus a Hidden tab and an admin override | Decision 01. |
| Dismiss sets `report_count = 0` | Dismiss stamps `dismissedAt` on open reports | Zeroing the count while report rows persist desynchronises the queue and permanently bars past reporters. |
| `UNIQUE(post_id, reporter_user_id)` | `UNIQUE(post_id, reporter_club_id, reporter_user_id)` | Member IDs are only unique within a club; across clubs they collide. |
| 10 MB per image, 4 images | 4 images, **9 MB combined** | Decision to leave the Caddy 10 MB body cap alone. |
| Pages at `/admin/posts` | Pages at `/posts` and `/settings` | Console pages are top-level here; `/admin` is the JSON API namespace. |
| Feed paginated on `created_at` | Keyset on `(createdAt, id)` | Same-millisecond posts straddling a page boundary are otherwise dropped. |
| Cron "daily at 02:00 UTC" | Explicit `{ timezone: "UTC" }` + advisory lock | The container sets `TZ=Pacific/Auckland`, so the naive schedule fires ~12 hours early. |

---

## 2. Settled decisions

**01 · Report trust.** 3 open reports from any club auto-hides a post. No
distinct-club requirement. Auto-hide is reversible: a Hidden tab lists every
hidden post and an admin can override. Applied as `auto_hide_threshold = 3`,
`auto_hide_min_clubs = 1`. The min-clubs lever stays in the settings table so it
can be raised later without a migration.

**02 · Who moderates.** ADMIN only. No moderator tier anywhere in this feature.
Every console page and `/api/admin` route calls a new `requireAdmin()`.

**03 · Image access.** Capability URLs — a 128-bit random `publicId` per image,
unguessable but not authorised. A leaked URL exposes that one image.

**04 · Author identity.** Club-asserted, accepted, documented. The server trusts
the posting club's key and cannot verify that a name belongs to a real member.
IDs are stored club-scoped so they can never collide across clubs.

**05 · Who can delete.** Members create; only a ServerNZ admin deletes. There is
no member self-delete endpoint. `posts:write` grants create and report only.

**06 · Retention default.** 12 months, with pruning skipped for any post still
under moderation.

**07 · Audit attribution.** Add a nullable `userId` to `AuditLog` so every
moderation entry names the admin who acted. Purely additive — existing rows keep
`NULL`, existing `recordAudit()` callers are unaffected, and the column ships in
the same `0004_posts` migration.

### Dead roles — noted, not touched

The `Role` enum still contains `MANAGER` and `USER`, and `requireManager()` is
still called by five existing files (clubs, tokens, other-lodges, audit). Nothing
in the codebase ever *creates* a non-ADMIN user — the seed only makes ADMIN, and
club registration creates no users at all — so both values are effectively dead.
This spec leaves them alone and simply does not use them. Removing them is a
clean, separate tidy-up.

---

## 3. Trust model

**Server-derived, never accepted from the client**

- `clubId` on a post — from the authenticated token.
- `reporterClubId` on a report — from the authenticated token.
- `hiddenAt`, `deletedAt`, `reportCount` — server state only.
- Image storage paths — generated server-side; the client never supplies or sees
  a filesystem path.

**Club-asserted, trusted but unverifiable**

- `authorUserId`, `authorName`, `authorEmail`
- `reporterUserId`

### What a 3-report threshold means

Because `reporterUserId` is a string the client supplies, a single club's API key
can manufacture three reports with three invented member IDs and hide any post in
the network. The threshold is the whole control, and it is lower than the brief's.

The Hidden Posts screen is what makes this workable, and it changes the character
of the feature: auto-hide stops being a verdict and becomes **a queue signal** —
fast, cheap, and fully reversible. Three things make that hold up:

1. The Hidden tab is *the* admin working surface, not a rarely-visited corner.
   Anything auto-hidden is waiting on a human.
2. `POST …/report` is rate-limited to 20/min per token, so a scripted flag flood
   is slow and lands in the audit log.
3. **`autoHideExempt`** — a per-post flag an admin sets when overriding. Without
   it, unhiding a targeted post just restarts the countdown and it re-hides at the
   next three reports, indefinitely. This is what makes "override the hide"
   actually mean something.

If flag abuse shows up, raise `auto_hide_min_clubs` from 1 to 2 in the settings
screen. No code change, no migration.

### Privacy boundary

`authorEmail` is stored for moderation contact and **must never appear in any
`/api/v1` response**. An `ALL_CLUBS` feed reaches every connected club;
serialising email there would hand every club the personal addresses of every
other club's members. The existing split between `serializeOtherLodge` and
`serializeOtherLodgeForClient` in `src/lib/other-lodges.ts` is the pattern to
copy — two serialisers, one internal, one client-facing.

For the same reason, `authorUserId` is returned only when the post's club matches
the requesting club. The widget needs it solely to hide the flag icon on the
reader's own posts, which is always a same-club comparison.

---

## 4. Data model

Repo conventions: camelCase Prisma fields with `@map` to snake_case columns,
`@@map` on every model, `cuid()` keys, explicit `onDelete`.

```prisma
enum PostScope {
  CLUB_ONLY
  ALL_CLUBS
}

enum PostHiddenBy {
  SYSTEM   // auto-hidden on reaching the report threshold
  ADMIN    // hidden by a server admin
}

enum ReportReason {
  SPAM
  INAPPROPRIATE
  HARASSMENT
  OTHER
}
```

```prisma
// A member post in the cross-club Communication Portal. `clubId` is always the
// authenticated club; the author fields are asserted by that club's install and
// are not independently verifiable (see Trust model).
model Post {
  id           String    @id @default(cuid())
  clubId       String    @map("club_id")
  club         Club      @relation(fields: [clubId], references: [id], onDelete: Cascade)

  authorUserId String    @map("author_user_id")
  authorName   String    @map("author_name")  @db.VarChar(200)
  // Moderation contact only. NEVER serialized to /api/v1 clients.
  authorEmail  String?   @map("author_email") @db.VarChar(320)

  scope        PostScope @default(CLUB_ONLY)
  content      String    @db.VarChar(4000)

  // Cached count of NON-dismissed reports. Recomputed on every report and on
  // dismissal, never blind-incremented.
  reportCount  Int       @default(0) @map("report_count")

  hiddenAt     DateTime?     @map("hidden_at")
  hiddenBy     PostHiddenBy? @map("hidden_by")

  // Admin override: this post has been reviewed and cleared, so the report
  // threshold must never auto-hide it again. Without this, unhiding a targeted
  // post simply restarts the countdown and it re-hides at the next 3 reports.
  autoHideExempt Boolean @default(false) @map("auto_hide_exempt")

  // Admin soft delete. Removed from every feed but recoverable; hard delete is
  // a separate, destructive console action that purges rows and files.
  deletedAt    DateTime?     @map("deleted_at")

  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt      @map("updated_at")

  images  PostImage[]
  reports PostReport[]

  // Feed keyset pagination is ordered by (createdAt DESC, id DESC).
  @@index([createdAt(sort: Desc), id(sort: Desc)])
  @@index([scope, clubId])
  @@index([reportCount])
  // Drives the console's Hidden tab.
  @@index([hiddenAt])
  @@map("posts")
}
```

```prisma
// One optimised WebP derivative. The original upload is never retained.
model PostImage {
  id       String @id @default(cuid())
  postId   String @map("post_id")
  post     Post   @relation(fields: [postId], references: [id], onDelete: Cascade)

  // Unguessable 32-hex capability id used in the public image URL. Random,
  // not derived from the row id, so URLs cannot be enumerated from a feed.
  publicId String @unique @map("public_id")

  // Path RELATIVE to UPLOADS_DIR, e.g. "posts/2026/08/<cuid>.webp".
  // Server-generated. Resolved against the root and re-checked before any
  // read or unlink, so a traversal sequence can never escape the directory.
  storageKey String @map("storage_key")

  width    Int
  height   Int
  bytes    Int
  position Int    @default(0)  // display order within the post, 0-3

  createdAt DateTime @default(now()) @map("created_at")

  @@index([postId])
  @@map("post_images")
}
```

```prisma
model PostReport {
  id             String       @id @default(cuid())
  postId         String       @map("post_id")
  post           Post         @relation(fields: [postId], references: [id], onDelete: Cascade)

  // Club is server-derived from the API token; the member id is club-asserted.
  reporterClubId String       @map("reporter_club_id")
  reporterClub   Club         @relation("PostReportClub", fields: [reporterClubId], references: [id], onDelete: Cascade)
  reporterUserId String       @map("reporter_user_id")

  reason         ReportReason
  details        String?      @db.VarChar(1000)

  // Set when an admin dismisses the report. Dismissed rows stay for the audit
  // trail but stop counting toward reportCount and the auto-hide threshold.
  dismissedAt    DateTime?    @map("dismissed_at")
  createdAt      DateTime     @default(now()) @map("created_at")

  // Club-scoped: member ids are unique within a club, not across clubs.
  @@unique([postId, reporterClubId, reporterUserId])
  @@index([postId])
  @@map("post_reports")
}
```

```prisma
// Small key/value store for operator-tunable settings. Values are strings;
// src/lib/settings.ts parses and defaults them through zod.
model SystemSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("system_settings")
}

// --- add to the existing Club model -------------------------------------
  posts       Post[]
  postReports PostReport[] @relation("PostReportClub")

// --- add to the existing AuditLog model (decision 07) --------------------
  userId String? @map("user_id")
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)
```

### Settings keys and defaults

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `posts.retention_days` | int | 365 | `0` disables pruning entirely |
| `posts.auto_hide_threshold` | int | 3 | Open reports needed to auto-hide |
| `posts.auto_hide_min_clubs` | int | 1 | Distinct reporting clubs also required. `1` = any club; raise to 2 if flag abuse appears |

Seed these in `prisma/seed.ts` alongside the existing idempotent admin seed, and
have `src/lib/settings.ts` fall back to the same defaults so a missing row is
never fatal. The retention dropdown maps to 90 / 183 / 365 / 730 / 1826 / 0 days.

### Migration

Write `prisma/migrations/0004_posts/migration.sql` by hand to match the existing
style: plain SQL with `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey`
section comments and explicit `ON DELETE … ON UPDATE CASCADE` clauses, exactly as
`0002_other_lodges` does. Generate with `prisma migrate dev --create-only`, then
edit the output into shape rather than letting it land as-is.

---

## 5. Media pipeline

### Where files live

A new `UPLOADS_DIR` environment variable, defaulting to `./data/uploads` in
development and `/app/data/uploads` in the container, backed by a named volume.
It sits **outside `public/`** for two reasons: the Dockerfile copies `public/`
from the build stage, so runtime writes there are destroyed on every rebuild; and
Next only serves assets present in `public/` at build time.

```ts
// Caddy caps the whole request body at 10MB (Caddyfile:27) and that cap
// stays. Budget 9MB for image bytes, leaving ~1MB for multipart boundaries
// and the text fields.
export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES_TOTAL = 9 * 1024 * 1024

export function uploadsRoot(): string
// Absolute UPLOADS_DIR, resolved once. Throws if unset in production.

export function resolveStorageKey(key: string): string
// Join key to the root, then assert the result is still INSIDE the root.
// Throws otherwise. Every read and unlink goes through this function.

export async function writeProcessedImage(buf: Buffer): Promise<{
  storageKey: string; publicId: string; width: number; height: number; bytes: number;
}>
// Sharded by year/month so no directory grows unbounded:
//   posts/2026/08/<cuid>.webp

export async function deleteStoredImage(key: string): Promise<boolean>
// Tolerates ENOENT — a missing file is a no-op, not an error.
```

### Validation and processing order

1. **Count first.** Reject more than 4 files before reading any of them.
2. **Combined size next.** Sum the parts; reject over 9 MB total with a `413`
   that names the limit and the actual size.
3. **Magic bytes.** Sniff the leading bytes of each file for JPEG (`FF D8 FF`),
   PNG (`89 50 4E 47`) or WebP (`RIFF….WEBP`). The declared `Content-Type` is not
   evidence.
4. **Decode with limits.** `sharp(buf, { limitInputPixels: 50_000_000, failOn: "error" })`
   — an unbounded decode is a memory-exhaustion vector regardless of file size.
5. **Resize** to fit 1920×1080, `fit: "inside"`, `withoutEnlargement: true`.
6. **Re-encode** to WebP at quality 80. Do *not* call `withMetadata()` — Sharp
   drops EXIF by default, which is what strips GPS coordinates from members'
   phone photos.
7. **Write** the derivative and record the row. The original is never persisted.

### Caddy stays at 10 MB

No `request_body` change. The `Caddyfile` keeps its site-wide 10 MB cap and the
post allowance is sized to fit underneath it.

Two consequences for the client. A typical phone photo is 3–8 MB, so **in
practice members will attach one or two images, not four** — the 4-image maximum
is rarely the binding constraint, the 9 MB budget is. And because the cap is on
the *combined* size, the client must show a running total and block the send
itself; without that, the failure arrives from Caddy as a bare 413 with no JSON
body and no explanation.

The upside is real: peak memory per concurrent upload drops from ~41 MB to
~10 MB, which matters on a single small container running Next, Prisma and Sharp
together.

### Blocker — sharp is not a declared dependency

It appears in `node_modules` transitively and is listed under `allowScripts`, but
not in `dependencies`. Add it explicitly, and add `"sharp"` to
`serverExternalPackages` in `next.config.ts` beside `@prisma/client` and
`bcryptjs` — it is a native module and the standalone bundle will break without
it.

---

## 6. Client API

All routes authenticate through the existing `authenticateApiRequest(req)`, which
resolves the club, rejects revoked tokens and non-`APPROVED` clubs, and stamps
`lastUsedAt`. All follow the established route-handler order: `clientIp` →
authenticate → rate limit → scope check → validate → act → `recordAudit` →
respond.

### Scopes

Two, mirroring the existing `lodges:read` / `lodges:write` pair rather than
inventing a third tier: **`posts:read`** (feed + stream) and **`posts:write`**
(create + report). Add them to the default array in `createTokenSchema`
(`src/lib/validation.ts`). Existing tokens will not carry them — either re-issue,
or have the console offer a scope top-up.

`checkRateLimit(key, now, max, windowMs)` already accepts per-call overrides, so
post creation and reporting can be limited far more tightly than the global
120/min without touching `src/lib/rate-limit.ts`.

### `GET /api/v1/feed` — `posts:read`

| Param | Type | Notes |
| --- | --- | --- |
| `limit` | int 1–50 | Default 20 |
| `before` | ISO 8601 | Cursor timestamp from the previous page |
| `beforeId` | cuid | Tiebreaker; required whenever `before` is given |

```ts
{
  deletedAt: null,
  hiddenAt: null,
  OR: [
    { scope: "ALL_CLUBS" },
    { scope: "CLUB_ONLY", clubId: club.id },
  ],
  // keyset: strictly "older than" the cursor
  ...(before ? {
    OR: [
      { createdAt: { lt: before } },
      { createdAt: before, id: { lt: beforeId } },
    ],
  } : {}),
}
// orderBy: [{ createdAt: "desc" }, { id: "desc" }]
```

Response — `serializePostForClient()`:

```jsonc
{
  "posts": [
    {
      "id": "clx…",
      "club": { "id": "clx…", "name": "Tararua Alpine Club", "code": "TAC" },
      "scope": "ALL_CLUBS",
      "authorName": "Jo Whitcombe",
      // Non-null ONLY when club.id === the requesting club. Lets the client
      // hide the flag icon on the reader's own posts.
      "authorUserId": "member-4417",
      "content": "Hut book from the Whitcombe trip is back at the lodge.",
      "images": [
        { "url": "https://…/api/images/posts/9f2c….webp", "width": 1920, "height": 1280 }
      ],
      "createdAt": "2026-08-22T04:11:08.221Z"
    }
  ],
  "cursor": { "before": "2026-08-21T…", "beforeId": "clx…" },
  "count": 20
}
// authorEmail is absent by construction. cursor is null on the last page.
```

### `POST /api/v1/posts` — `posts:write`, 10/min

`multipart/form-data`. Fields: `author_user_id`, `author_name`, `author_email?`,
`content`, `scope`, `images[]` (0–4, 9 MB combined).

- `content`: trimmed, 1–4000 chars, stored as **plain text**.
- Images processed per the pipeline above; a failure on any one image fails the
  whole request and unlinks anything already written.
- `clubId` from the token. Post row and image rows created in one
  `prisma.$transaction` after all files are safely on disk.
- Broadcast `post_created` to eligible SSE subscribers.
- `recordAudit({ action: "post.create", … })`.

**On "sanitize to prevent XSS":** there is no sanitiser in the dependency tree
and none is needed. Store plain text and let React escape it at render — the
vulnerability only exists if someone reaches for `dangerouslySetInnerHTML`. Strip
control characters, normalise whitespace, reject nothing else.

### `POST /api/v1/posts/[id]/report` — `posts:write`, 20/min

`application/json`: `{ reporter_user_id, reason, details? }`. The reporting club
comes from the token.

```ts
const result = await prisma.$transaction(async (tx) => {
  const post = await tx.post.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, clubId: true, scope: true,
              hiddenAt: true, autoHideExempt: true },
  })
  if (!post) return { status: "not-found" } as const

  // Visibility check: you cannot report what you were never allowed to see.
  if (post.scope === "CLUB_ONLY" && post.clubId !== club.id) {
    return { status: "not-found" } as const   // 404, not 403 — don't confirm it exists
  }

  try {
    await tx.postReport.create({ data: { postId: post.id, reporterClubId: club.id, … } })
  } catch (error) {
    // P2002 = this member already reported this post. Idempotent success:
    // return 200 WITHOUT recounting, so a retry can't move the needle.
    if (isUniqueViolation(error)) return { status: "duplicate" } as const
    throw error
  }

  // Recount rather than blind-increment: dismissed rows must not count, and
  // a recount is immune to drift from any earlier partial failure.
  const open = await tx.postReport.findMany({
    where: { postId: post.id, dismissedAt: null },
    select: { reporterClubId: true },
  })
  const distinctClubs = new Set(open.map((r) => r.reporterClubId)).size

  const shouldHide =
    !post.hiddenAt &&
    !post.autoHideExempt &&                            // admin already cleared it
    open.length >= settings.autoHideThreshold &&       // default 3
    distinctClubs >= settings.autoHideMinClubs         // default 1 = any club

  await tx.post.update({
    where: { id: post.id },
    data: {
      reportCount: open.length,
      ...(shouldHide ? { hiddenAt: new Date(), hiddenBy: "SYSTEM" } : {}),
    },
  })
  return { status: "recorded", hidden: shouldHide, post } as const
})

// Broadcast AFTER the transaction commits, never inside it.
if (result.status === "recorded" && result.hidden) {
  broadcastPostRemoved(result.post, "hidden")
}
```

Responses: `200 { status: "recorded" | "duplicate", hidden: boolean }`, `404` if
the post is missing, deleted, or outside the caller's scope. Audit action
`post.report` either way.

**No member delete.** Members create; only a server admin removes. The thing to
watch for: a member who posts something by mistake has to reach a ServerNZ admin,
and their post stays live in every connected club's feed until that happens.
Whatever contact route you expect them to use is worth writing into the client's
help text.

### `GET /api/images/posts/[publicId].webp` — capability URL, unauthenticated

Deliberately outside `/api/v1`, because it is not part of the authenticated
client API. Looks up `publicId`, returns 404 if the post is deleted, streams the
file from `resolveStorageKey()`, and sets
`Cache-Control: private, max-age=31536000, immutable` — content is immutable per
id, so a long cache is safe and a deleted post's URL simply starts 404ing.

---

## 7. Live updates — `GET /api/v1/feed/stream`, `posts:read`

### Blocker — EventSource cannot authenticate

The browser `EventSource` API cannot set request headers, so it cannot present an
API key. Two workable paths:

- **Preferred — fetch-based reader.** The client calls `fetch()` with the
  `Authorization` header and reads the `ReadableStream`, parsing SSE frames
  itself. ~40 lines, works in Electron and every current browser, and needs no
  server concessions.
- **Fallback — one-time stream ticket.** An authenticated
  `POST /api/v1/feed/stream/ticket` returns a 60-second single-use token which
  `EventSource` passes as a query parameter.

Do **not** put the API key itself in a query string — the Caddyfile logs every
request line to stdout, so the key would land in the container logs.

```ts
// src/lib/post-events.ts
// In-process subscriber registry. Single-container deployment only —
// the same constraint src/lib/rate-limit.ts already documents.
interface Subscriber { clubId: string; send: (event: string, data: unknown) => void }

export function subscribe(sub: Subscriber): () => void
export function broadcastPostCreated(post: PostRecord): void
export function broadcastPostRemoved(
  post: { id: string; clubId: string; scope: PostScope },
  reason: "hidden" | "deleted",
): void

// Both broadcasts apply the SAME visibility predicate as GET /api/v1/feed:
//   scope === "ALL_CLUBS" || post.clubId === subscriber.clubId
// Skipping it on post_removed would leak the existence and ids of other
// clubs' private posts to every connected club.
```

```ts
export const runtime = "nodejs"       // not edge — needs the Prisma client
export const dynamic = "force-dynamic" // never statically optimised or cached

// Response headers:
//   Content-Type: text/event-stream
//   Cache-Control: no-cache, no-transform
//   Connection: keep-alive
//   X-Accel-Buffering: no

// Heartbeat every 30s as an SSE comment frame (":ping\n\n"). On
// request.signal 'abort': clear the interval AND unsubscribe — a leaked
// subscriber holds a closed controller and throws on the next broadcast.
// Cap concurrent streams per token (suggest 5).
```

The one Caddyfile change this feature still needs:

```caddyfile
reverse_proxy app:3000 {
	header_up X-Real-IP {remote_host}
	header_up X-Forwarded-For {remote_host}
	header_up X-Forwarded-Proto {scheme}
	flush_interval -1
}
```

**There is no replay buffer.** SSE delivers only what happens while the socket is
open. A client that reconnects after a dropout **must** call `GET /api/v1/feed`
with its last known cursor to backfill. Without that step, every network blip
silently produces a hole in the feed.

| Event | Payload | Sent when |
| --- | --- | --- |
| `post_created` | Full serialised post | A visible post is created |
| `post_removed` | `{ id, reason }` | Auto-hidden at 3 reports, admin-hidden, or admin-deleted |
| `:ping` | comment frame | Every 30s |

---

## 8. Admin console

### Blocker — new pages are unauthenticated by default

`src/proxy.ts` gates a fixed prefix list *and* a matching `config.matcher`. A new
page matching neither renders for anonymous visitors. Both lists need `/posts`
and `/settings` added — and because the proxy runs on the Edge runtime and only
verifies the JWT signature, every page and route must **still** call
`requireAdmin()` for the actual authorisation check.

```ts
// src/lib/admin-guard.ts
/**
 * Assert an authenticated ADMIN session. The Communication Portal is
 * admin-only: there is no moderator tier on this server.
 */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session || session.role !== "ADMIN") throw new Error("Not authorized")
  return session
}
```

Pages sit at `/posts` and `/settings` to match the existing top-level console
pages (`/clubs`, `/lodges`, `/audit`), with links added to `ConsoleShell`.

### Three tabs

| Tab | Query | Purpose |
| --- | --- | --- |
| **Flagged** | open reports, `reportCount` desc | Reported but still under the threshold — early warning |
| **Hidden** | `hiddenAt != null`, newest first | The working queue. Everything auto-hidden at 3 reports lands here awaiting a human |
| **All posts** | everything, newest first | Search and removal. The only path by which any post can be deleted |

The Hidden tab is the feature, not a sub-page. With auto-hide at three reports and
no distinct-club requirement, posts will land here on relatively weak signals —
that is the accepted trade. It should show a **count badge in the console nav**,
because an unattended queue means a legitimate post stays invisible to every club
indefinitely. Each row should distinguish `hiddenBy: SYSTEM` from
`hiddenBy: ADMIN` at a glance — only the former is asking for a decision.

### Actions — all `requireAdmin()`

| Action | Route | Effect |
| --- | --- | --- |
| List / search | `GET /api/admin/posts` | `?tab=flagged\|hidden\|all`, plus `?q=` over content and author name, `?clubId=`, date range |
| Hide | `PATCH /api/admin/posts/[id]` | Sets `hiddenAt` + `hiddenBy: ADMIN` |
| **Override hide** | `POST /api/admin/posts/[id]/unhide` | Clears `hiddenAt`/`hiddenBy`, dismisses open reports, recomputes `reportCount` to 0. Optional `{ exempt: true }` also sets `autoHideExempt` |
| Dismiss reports | `POST /api/admin/posts/[id]/dismiss` | Stamps `dismissedAt` on open reports and recomputes the count, leaving visibility as-is |
| Edit text | `PATCH /api/admin/posts/[id]` | Replaces `content`; original captured in the audit metadata |
| Delete one image | `DELETE /api/admin/posts/[id]/images/[imageId]` | Row deleted, then `deleteStoredImage()` |
| Soft delete | `PATCH /api/admin/posts/[id]` | Sets `deletedAt`. Gone from every feed, recoverable, files retained |
| Hard delete | `DELETE /api/admin/posts/[id]` | Cascades reports and image rows, unlinks files, broadcasts `post_removed`. Not recoverable — confirm in the UI |
| Read/write settings | `GET\|PUT /api/admin/settings` | Retention days, auto-hide threshold, minimum clubs |
| Run cleanup now | `POST /api/admin/settings/cleanup` | Invokes the same function the cron calls; returns the stats block |

**Dismiss, done properly.** The brief's "reset `report_count = 0`" leaves the
count disagreeing with the rows it summarises, keeps stale reasons on screen, and
— because of the unique constraint — permanently bars everyone who already
reported from ever reporting again. Stamping `dismissedAt` instead keeps the full
history visible, lets the count be recomputed from truth, and leaves the post
genuinely re-reportable by a fresh set of members.

Each row shows author name and club, post age, open report count, a per-reason
breakdown (`groupBy` on `reason` where `dismissedAt is null`), the reporting
clubs, and every `details` note.

Every action calls `recordAudit()` with the acting admin, so moderation shows up
in the existing `/audit` screen. Suggested actions: `post.hide`, `post.unhide`,
`post.exempt`, `post.dismiss`, `post.edit`, `post.image.delete`,
`post.softDelete`, `post.delete`, `settings.update`, `posts.cleanup`.

---

## 9. Retention job

### Blocker — two scheduling traps

**Timezone.** The Dockerfile sets `TZ=Pacific/Auckland`. `node-cron` uses the
process timezone by default, so `"0 2 * * *"` fires at 02:00 NZT — roughly 14:00
UTC, half a day from where the brief intends. Pass `{ timezone: "UTC" }`
explicitly.

**No startup hook.** A Next standalone server has nowhere to start a scheduler.
Add `src/instrumentation.ts` with a `register()` export, guarded on
`process.env.NEXT_RUNTIME === "nodejs"` so it does not also run in the Edge
runtime or under `next dev` reloads.

```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NODE_ENV !== "production") return   // opt in via env for dev

  const cron = await import("node-cron")
  cron.schedule("0 2 * * *", () => { void runPostCleanup({ trigger: "cron" }) },
    { timezone: "UTC" })
}
```

```ts
// src/lib/post-cleanup.ts — single-execution guard
// A Postgres advisory lock makes the job safe if the app is ever run with
// more than one instance, and costs nothing today. It also prevents the
// "Run cleanup now" button from racing the 02:00 cron.
const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
  SELECT pg_try_advisory_lock(4823001) AS locked`
if (!locked) return { skipped: "already-running" }
try { /* … */ } finally {
  await prisma.$queryRaw`SELECT pg_advisory_unlock(4823001)`
}
```

### Deletion order

1. Read `posts.retention_days`. `0` → return `{ skipped: "disabled" }`.
2. Select candidate ids where `createdAt < cutoff`, **excluding posts with open
   (non-dismissed) reports**. A post sitting in the Hidden or Flagged queue is
   evidence; pruning it destroys the case before anyone has ruled on it. Count and
   log the exclusions.
3. Collect the `storageKey` list for those posts.
4. Delete the post rows in a transaction — `post_images` and `post_reports`
   cascade.
5. Unlink the files, tolerating `ENOENT`.
6. Sweep `UPLOADS_DIR` for files older than 24 hours with no matching `PostImage`
   row. This also collects derivatives written by uploads whose transaction later
   rolled back.
7. `recordAudit({ action: "posts.cleanup", metadata: stats })`.

**Why rows before files.** The brief deletes files first. If the process dies
between the two steps, that leaves rows pointing at files that no longer exist —
every affected post renders with broken images, visibly and permanently. This
order leaves the opposite failure: orphaned files with no rows, which waste disk
but are invisible to users and are reclaimed by step 6. Prefer the failure mode
nobody has to look at.

Return and log
`{ postsDeleted, imagesDeleted, filesUnlinked, reportsDeleted, skippedUnderReview, orphansCollected, durationMs }`
— this is what the `/settings` page shows after a manual run.

---

## 10. Infrastructure changes

```yaml
# docker-compose.yml
services:
  app:
    volumes:
      - uploads_data:/app/data/uploads     # NEW — without this, images
    environment:                           # vanish on every rebuild
      UPLOADS_DIR: /app/data/uploads

volumes:
  db_data:
  uploads_data:                            # NEW
  caddy_data:
  caddy_config:
```

| File | Change |
| --- | --- |
| `Dockerfile` | `mkdir -p /app/data/uploads && chown nextjs:nodejs` before `USER nextjs` — the volume must be writable by the unprivileged user |
| `docker-compose.dev.yml` | Same volume and env var so dev matches production |
| `Caddyfile` | `flush_interval -1` on the reverse proxy, for SSE. **Body limit stays at 10 MB** |
| `next.config.ts` | Add `"sharp"` to `serverExternalPackages` |
| `package.json` | Add `sharp` and `node-cron` to `dependencies`; `@types/node-cron` to dev |
| `src/proxy.ts` | `/posts` and `/settings` in *both* `PROTECTED_PREFIXES` and `config.matcher` |
| `src/lib/admin-guard.ts` | Add `requireAdmin()` |
| `.gitignore` | `/data` |
| `.env.example` | `UPLOADS_DIR`, documented like the existing entries |
| `README.md` | Note the new volume, and that uploads are on local disk — a second app replica would break SSE, the rate limiter, and image serving alike |

---

## 11. Client integration — contract only

The member-facing UI belongs to the AlpineClubBookingsNZ booking client, a
separate repository. It cannot be built as part of this work. What that
implementer needs:

- **Credentials.** The install's existing API token (already held in that repo's
  encrypted credential store and reached via `getOperationalServerNzApiKey()`),
  plus the local session's member id, display name and email, sent as post fields.
- **Initial load.** `GET /api/v1/feed?limit=20`, then follow `cursor` for older
  pages.
- **Live.** Fetch-based SSE reader, or scheduled polling. **On every reconnect,
  backfill from the last cursor** — the stream has no replay.
- **Composer size budget.** Up to 4 images, but **9 MB combined**. Show a running
  total and block the send client-side; a server-side rejection arrives from Caddy
  as a bare 413 with no JSON body.
- **Own posts.** Hide the flag icon when `post.authorUserId` equals the session
  member id. It is non-null only for same-club posts.
- **No self-delete.** There is no member delete endpoint. If the design implies
  members can retract a post, that expectation needs removing — and the UI should
  say who to contact instead.
- **Report modal.** Radio: Spam / Inappropriate content / Harassment / Other;
  optional note, 1000 chars.
- **After reporting.** The server returns `{ status, hidden }`. Show a "Reported"
  state and collapse the card. This is local-only — the post returns on next
  launch unless it was auto-hidden.
- **Removal events.** On `post_removed`, fade out the matching card if it is on
  screen. Ignore ids not currently rendered.
- **Images.** Plain `<img src>` against the returned URLs; no auth header needed.

---

## 12. Build order

Sequential — each step compiles and is testable before the next begins.

1. Schema additions + hand-written `0004_posts` migration + seeded settings.
2. `requireAdmin()` in `src/lib/admin-guard.ts`.
3. `src/lib/settings.ts` (zod-parsed, defaulted key/value access).
4. `src/lib/posts.ts` — select objects, both serialisers, zod schemas. Mirrors
   `other-lodges.ts`.
5. `src/lib/uploads.ts` + the sharp pipeline. Testable in isolation with fixture
   images.
6. `GET /api/images/posts/[publicId]` — proves storage end to end before any
   writes exist.
7. `POST /api/v1/posts` and `GET /api/v1/feed`.
8. `src/lib/post-events.ts` + the SSE route; wire broadcasts into step 7.
9. `POST /api/v1/posts/[id]/report`.
10. Admin API routes, then the `/posts` (three tabs) and `/settings` pages, then
    `proxy.ts` and `ConsoleShell`.
11. `post-cleanup.ts` + `instrumentation.ts` + the manual trigger.
12. Compose, Dockerfile, Caddyfile, env and README.

**Where to cut if this ships in two parts.** Steps 1–9 deliver a working feed
with reporting and auto-hide, but no console — which means **posts can be
auto-hidden with no way to review or override them**. That is not a safe stopping
point. If the work must split, carry the Hidden tab and the unhide route from step
10 forward into part one; the settings page and cleanup job can wait.

---

## 13. Test plan

Vitest, co-located in `__tests__` beside the code, matching the existing layout.

| File | Covers |
| --- | --- |
| `src/lib/__tests__/posts.test.ts` | Serialiser omits `authorEmail`; `authorUserId` null for other clubs; zod bounds |
| `src/lib/__tests__/uploads.test.ts` | Magic-byte rejection of a renamed non-image; combined size over 9 MB rejected; traversal keys throw; `ENOENT` unlink is a no-op; EXIF absent from output |
| `src/lib/__tests__/settings.test.ts` | Missing rows fall back to defaults; malformed values do not throw |
| `src/lib/__tests__/post-events.test.ts` | `CLUB_ONLY` events reach only the owning club, on create *and* removal |
| `…/api/v1/__tests__/feed-route.test.ts` | Scope filtering; hidden and deleted excluded; keyset paging across same-millisecond posts |
| `…/api/v1/__tests__/post-report-route.test.ts` | **Two reports do not hide; the third does**; three from one club is enough; duplicate returns 200 without recounting; `autoHideExempt` post never hides; cross-club `CLUB_ONLY` report → 404 |
| `…/api/v1/__tests__/posts-route.test.ts` | Scope enforcement; >4 images rejected; failed image processing leaves no orphaned files or rows |
| `…/api/admin/__tests__/posts-admin-route.test.ts` | Non-ADMIN session rejected on every route; unhide dismisses reports and zeroes the count; `{ exempt: true }` survives a fresh round of reports; hard delete unlinks files |
| `src/lib/__tests__/post-cleanup.test.ts` | Retention `0` is a no-op; posts under review skipped; orphan sweep collects; stats accurate |

**The three worth writing first:** the 2-vs-3 threshold boundary, the
duplicate-report case, and the `autoHideExempt` override. Together they pin down
the entire auto-hide contract.

---

*Rev B — decisions 01–07 settled and applied. Drafted against commit `c687b4f` on
`main`; line references such as `Caddyfile:27`, `src/proxy.ts:16` and
`Dockerfile:52` are accurate as at that commit.*
