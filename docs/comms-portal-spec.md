# Communication Portal — implementation spec

**Status:** ready to build · **Rev C** · 22 Aug 2026
**Supersedes:** the original "multi-club Communication Portal" brief, and spec rev A/B
**Migration:** `0004_posts`
**Rendered copy:** https://claude.ai/code/artifact/5a28de3b-4d65-44a6-ae57-c1648f800c24

A cross-club member feed with image posts, member reporting, and central
moderation. The original brief assumed a Node/Express stack that this
repository does not run; this document rewrites it against Next.js 16 App
Router + Prisma 7 + PostgreSQL 16, following the conventions already
established in `src/lib` — and against the ServerNZ integration the
AlpineClubBookingsNZ client already has.

## Rev C — four changes, driven by reading the booking client

The client repo already has `servernz-api.ts`, a cursor-based
`servernz-other-lodges-sync.ts`, a single-flight `servernz-sync-claim.ts`, and an
`/api/cron/alpine-server-sync` route. It will **mirror** this feed into its own
database the same way it mirrors Other Lodges, not render it live from a browser
widget. That reshapes four things:

1. **New `GET /api/v1/feed/sync`** — a forward cursor for mirroring.
   `/api/v1/feed` keeps its backward keyset for direct browsing.
2. **Removals now propagate.** A cursor pull of *visible* posts can never tell a
   mirror that a post was hidden or deleted — it silently stops appearing and the
   mirror shows it forever. Solved without a tombstone table (§7).
3. **SSE is gone.** With the browser never talking to ServerNZ, the EventSource
   auth problem evaporates and a held-open connection per club install is worse
   than a cursor poll on the cron the client already runs. This also removes the
   only Caddyfile change the feature needed.
4. **The cleanup lock is corrected.** Rev B used `pg_try_advisory_lock`; the
   client repo documents why that is wrong under Prisma (§9).

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
| Cron "daily at 02:00 UTC" | Explicit `{ timezone: "UTC" }` + a status-guarded claim | The container sets `TZ=Pacific/Auckland`, so the naive schedule fires ~12 hours early. |

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

  // Admin soft delete. Gone from every feed, recoverable, files retained.
  deletedAt    DateTime?     @map("deleted_at")

  // Hard delete. Content is blanked and every image file is unlinked AT ONCE —
  // the objectionable material is gone immediately. What survives is a stub row
  // carrying nothing but id/clubId/scope/timestamps, which IS the tombstone that
  // tells mirroring clients to drop their copy. The stub is pruned by the
  // retention job once posts.tombstone_horizon_days has passed.
  purgedAt     DateTime?     @map("purged_at")

  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt      @map("updated_at")

  images  PostImage[]
  reports PostReport[]

  // Feed keyset pagination is ordered by (createdAt DESC, id DESC).
  @@index([createdAt(sort: Desc), id(sort: Desc)])
  // The mirroring cursor: GET /api/v1/feed/sync orders by (updatedAt, id) ASC.
  @@index([updatedAt, id])
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

// Single-flight claim for scheduled jobs. Two lines, properly typed, and it
// keeps the claim OUT of SystemSetting (whose value column is a String — a
// timestamp claim there would rest on ISO strings sorting lexicographically,
// which is true but too clever to rely on). See §9 for why this rather than a
// Postgres advisory lock.
model JobClaim {
  name      String    @id
  startedAt DateTime? @map("started_at")

  @@map("job_claims")
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
| `posts.tombstone_horizon_days` | int | 90 | How long a purged post's stub row survives so mirrors can converge. Must exceed the longest plausible client outage (§7) |

Seed these in `prisma/seed.ts` alongside the existing idempotent admin seed,
together with the `posts.cleanup` `JobClaim` row — the guarded claim in §9 never
fires if its row is absent. Have `src/lib/settings.ts` fall back to the same
defaults so a missing setting row is never fatal. The retention dropdown maps to 90 / 183 / 365 / 730 / 1826 / 0 days.

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
- No broadcast step. Mirrors pick the post up on their next
  `/api/v1/feed/sync` pass.
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

// Nothing to push. The update bumped `updatedAt`, so the next /feed/sync
// pass from each club carries { state: "removed", reason: "hidden" }.
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

## 7. Mirroring and convergence

The booking client keeps its own copy of the feed and renders from it. This
section defines the endpoint that keeps that copy correct — including the part
the brief never addressed: how a mirror learns that something was *removed*.

### `GET /api/v1/feed/sync` — `posts:read`

A forward cursor over `updatedAt`, mirroring the contract
`GET /api/v1/other-lodges?since=` already uses, so the client's existing sync
code has a shape to copy. Separate from `/api/v1/feed` because the two answer
different questions: `/feed` is "show me visible posts, newest first" for a
client that renders live; `/feed/sync` is "what changed since I last asked",
removals included.

| Param | Type | Notes |
| --- | --- | --- |
| `since` | ISO 8601 | Omit for a full initial sync |
| `limit` | int 1–200 | Default 100 |

### The removal problem

Pull every post with `updatedAt > cursor` and you get creations and edits. You do
**not** get removals: a hidden or deleted post simply stops matching the filter,
so the mirror never hears about it and keeps serving it to members indefinitely.
Auto-hide at three reports would be visible on ServerNZ and inert everywhere else.

The same gap makes retention fiction. ServerNZ prunes at 12 months; if mirrors
never learn, every connected club keeps its copies forever and the policy is true
only on the server.

**Solved without a tombstone table.** The obvious fix is a `post_tombstones`
table. It is not needed, because three of the four removal paths already leave a
row behind:

- **Hidden** — row persists with `hiddenAt` set.
- **Soft deleted** — row persists with `deletedAt` set.
- **Hard deleted** — this is the one that used to vanish. Redefined so that
  content is blanked and every image file is unlinked *immediately*, while a stub
  row survives carrying only id, club, scope and timestamps. The material is gone
  at once, which is what hard delete is for; the stub is purely a signal, and the
  retention job removes it after `tombstone_horizon_days`.
- **Retention-pruned** — no signal needed. Mirrors apply the same retention window
  locally, driven by the `retentionDays` the sync response advertises.

One column (`purgedAt`) instead of a table, a model, a scope-filtered index and
its own pruning pass.

```jsonc
{
  "changes": [
    // A live post: full payload, same serialiser as GET /api/v1/feed.
    { "state": "visible", "post": { "id": "clx…", "club": {…}, "content": "…", … } },

    // Removed. NO content, NO author, NO images — the mirror only needs to know
    // which row to drop. Sending the body of a post that was hidden for being
    // abusive would defeat the point of hiding it.
    { "state": "removed", "id": "clx…", "reason": "hidden" },
    { "state": "removed", "id": "clx…", "reason": "deleted" }
  ],
  "cursor": "2026-08-22T04:11:08.221Z",   // max updatedAt in this page
  "hasMore": true,                        // page again immediately when true

  // Policy the server expects mirrors to apply locally.
  "retentionDays": 365,
  // Oldest cursor still serviceable. A client whose stored cursor predates
  // this has missed removals it can never catch up on — it MUST discard its
  // mirror and resync from scratch rather than carry stale rows forever.
  "tombstoneHorizon": "2026-05-24T00:00:00.000Z"
}
```

Scope filtering is identical to the browse feed and applies to removals too:
`scope === "ALL_CLUBS" || clubId === requesting club`. A `CLUB_ONLY` post's
removal must not be announced to clubs that were never shown the post — otherwise
the sync channel leaks the ids and existence of every club's private posts.

### Two cursor traps

**Commit order, not timestamp order.** An `updatedAt` cursor assumes rows become
visible in timestamp order. They do not: a transaction that stamps
`updatedAt = T1` may commit *after* one stamped `T2 > T1`. A client that advanced
its cursor to `T2` will never see the `T1` row — permanently. The cheap, standard
fix, and the one to specify: the client re-requests with a small overlap
(`cursor − 60s`) on every pass, and its upsert is idempotent so re-seeing a row
costs nothing. `servernz-other-lodges-sync.ts` has the same exposure today; the
overlap is a one-line improvement there too.

**Reports bump `updatedAt`.** Recording a report writes `reportCount`, which bumps
`updatedAt` and re-sends the post to every mirror even though nothing
client-visible changed. Accepted rather than engineered around: it is one row, the
write is idempotent, and reports are rare. Splitting moderation counters onto a
side table to avoid the churn costs more than the churn does.

### Ordering and paging

```ts
// No deletedAt/hiddenAt filter — removals are the point of this endpoint.
// Post state maps to the response `state` in the serialiser, not in the query.
where: {
  updatedAt: { gt: since },
  OR: [
    { scope: "ALL_CLUBS" },
    { scope: "CLUB_ONLY", clubId: club.id },
  ],
},
orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
take: limit + 1,   // the extra row is how hasMore is computed
```

**A page boundary must not split a timestamp.** If `limit` rows all share one
`updatedAt` and the next row shares it too, returning `cursor =` that timestamp
makes the next request skip the remainder (`gt`), while returning it and
re-requesting `gt` the previous value loops forever. Either page on the composite
`(updatedAt, id)` and return both parts, or extend the page to swallow every row
sharing the final timestamp. The composite is the honest one and matches what
`/api/v1/feed` already does for `before`/`beforeId`.

### Why not SSE

Rev B specified an SSE stream, an in-process subscriber registry, a fetch-based
reader to work around `EventSource` being unable to send an `Authorization`
header, and a `flush_interval -1` Caddy change. None of it survives contact with a
mirroring client:

- The browser never talks to ServerNZ, so there was never an `EventSource` — it is
  a server-to-server call with a Bearer header, which was always fine.
- A connection held open from every club install, indefinitely, is strictly worse
  than a cursor poll on the cron the client already runs.
- SSE has no replay buffer, so a mirror would still need this endpoint for
  backfill after any dropout. Two mechanisms where one does the job.

Removing it deletes an endpoint, `post-events.ts`, the ticket route, and the last
Caddyfile change this feature required. In-page freshness becomes the client's own
concern against its local database.

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
| Hard delete | `DELETE /api/admin/posts/[id]` | Blanks `content`, deletes image rows, unlinks files, sets `purgedAt`. Reports cascade. A stub row survives as the mirror tombstone until the horizon passes (§7). Not recoverable — confirm in the UI |
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

### Correction — rev B's advisory lock was wrong

Rev B specified `pg_try_advisory_lock` / `pg_advisory_unlock` through
`prisma.$queryRaw`. The booking client's `src/lib/servernz-sync-claim.ts`
documents why that fails under Prisma, having hit it already:

- A **session-scoped** advisory lock is taken and released through Prisma's
  connection *pool*, so the unlock can execute on a different connection than the
  lock. The lock then never releases and the job is wedged until the pool
  recycles — silently.
- An **xact-scoped** `pg_advisory_xact_lock` releases at commit, so covering the
  pass means holding a transaction open across file I/O. Long transaction, worse
  problem.

Use their status-guarded claim instead: a conditional `updateMany` whose `count`
*is* the claim. It is atomic, releases in a `finally`, and a process killed
mid-pass is reaped by staleness rather than wedging anything.

```ts
// src/lib/post-cleanup.ts — single-execution guard
// Generous relative to a real pass: reaping early is merely wasteful (two
// overlapping passes), whereas reaping late leaves a wedged job, which is silent.
const STALE_CLAIM_AFTER_MS = 30 * 60 * 1000

const claim = await prisma.jobClaim.updateMany({
  where: {
    name: "posts.cleanup",
    OR: [
      { startedAt: null },
      { startedAt: { lt: new Date(now.getTime() - STALE_CLAIM_AFTER_MS) } },
    ],
  },
  data: { startedAt: now },
})

// count === 1 means THIS caller moved the row from "free or stale" to "held",
// atomically. Any concurrent caller matched zero rows and does nothing —
// which is what stops "Run cleanup now" racing the 02:00 cron.
if (claim.count === 0) return { skipped: "already-running" }

try {
  /* … the pass … */
} finally {
  // Release regardless of outcome: a failed pass must not wedge the next one.
  await prisma.jobClaim.update({
    where: { name: "posts.cleanup" },
    data: { startedAt: null },
  })
}
```

Seed the `posts.cleanup` row in `prisma/seed.ts` — the guarded `updateMany`
matches nothing if the row does not exist, so a missing row reads as "permanently
held" and the job would never run.

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
6. **Prune purged stubs.** Delete rows where
   `purgedAt < now − tombstone_horizon_days`. These carry no content or files
   already — they exist only to tell mirrors to drop their copy, and every mirror
   that is going to hear the message has heard it by now.
7. Sweep `UPLOADS_DIR` for files older than 24 hours with no matching `PostImage`
   row. This also collects derivatives written by uploads whose transaction later
   rolled back.
8. `recordAudit({ action: "posts.cleanup", metadata: stats })`.

**Retention is a shared policy, not a local one.** Step 2 deletes rows outright,
leaving no signal — deliberately. Mirrors are not told about retention pruning;
they apply the same window themselves, using the `retentionDays` value
`/api/v1/feed/sync` advertises. The consequence to hold on to: **retention only
actually deletes member content if the clients honour it.** A club running a
modified or stale client keeps its copies. Worth stating plainly wherever the
retention setting is described to an operator, because the setting reads like a
guarantee and is really an instruction.

**Why rows before files.** The brief deletes files first. If the process dies
between the two steps, that leaves rows pointing at files that no longer exist —
every affected post renders with broken images, visibly and permanently. This
order leaves the opposite failure: orphaned files with no rows, which waste disk
but are invisible to users and are reclaimed by step 6. Prefer the failure mode
nobody has to look at.

Return and log
`{ postsDeleted, imagesDeleted, filesUnlinked, reportsDeleted, skippedUnderReview, stubsPruned, orphansCollected, durationMs }`
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
| `Caddyfile` | **No change.** Rev B needed `flush_interval -1` for SSE; with SSE removed the file is untouched and the 10 MB body cap stands |
| `next.config.ts` | Add `"sharp"` to `serverExternalPackages` |
| `package.json` | Add `sharp` and `node-cron` to `dependencies`; `@types/node-cron` to dev |
| `src/proxy.ts` | `/posts` and `/settings` in *both* `PROTECTED_PREFIXES` and `config.matcher` |
| `src/lib/admin-guard.ts` | Add `requireAdmin()` |
| `prisma/seed.ts` | Seed the four `SystemSetting` rows and the `posts.cleanup` `JobClaim` row — the guarded claim never fires if its row is absent |
| `.gitignore` | `/data` |
| `.env.example` | `UPLOADS_DIR`, documented like the existing entries |
| `README.md` | Note the new volume, and that uploads are on local disk — a second app replica would break the rate limiter and image serving alike |

---

## 11. Client integration — AlpineClubBookingsNZ

The member-facing half lives in the booking client, a separate repository. It is
not built as part of this work, but it is no longer a blank contract: that repo
already has a mature ServerNZ integration, and this feature should extend it
rather than invent a second way of talking to the same server.

```
member browser ──▶ BookingsNZ app ──▶ local Postgres      (the feed renders from here)
                         │
                         ├── cron pull  ──▶ ServerNZ  GET  /api/v1/feed/sync?since=
                         ├── live POST  ──▶ ServerNZ  POST /api/v1/posts
                         └── live POST  ──▶ ServerNZ  POST /api/v1/posts/:id/report
```

**Reads mirror, writes proxy.** The feed renders from the club's own database, so
it survives ServerNZ being slow or down. Writes go straight through, because a
post or a report is meaningless if it only lands locally.

Why not the two simpler options: **browser straight to ServerNZ** is not
available — the API key is a *club* credential held in that repo's encrypted store
and reached through `getOperationalServerNzApiKey()`; putting it in a browser
exposes every club's key to every member, and CORS sits on top. **A pure live
proxy** keeps the key safe but makes the feed only as available as ServerNZ, with
a 10s timeout on each render.

### Files to change, in order

**1 · `src/lib/servernz-api.ts`** — three functions alongside `uploadOtherLodges` /
`pullOtherLodges`, reusing `resolveConnection()`, `authHeaders()`, `readError()`
and the existing `REQUEST_TIMEOUT_MS` unchanged:

```ts
export async function pullCommsFeed(since?: string | null): Promise<CommsPullResult>
export async function createCommsPost(input: CommsPostInput): Promise<CommsPostResult>
export async function reportCommsPost(
  postId: string, input: CommsReportInput,
): Promise<{ status: "recorded" | "duplicate"; hidden: boolean }>

// createCommsPost sends multipart/form-data, so it CANNOT use authHeaders() —
// that sets Content-Type: application/json, which would break the boundary.
// Pass a FormData body and let fetch set the header, keeping only Authorization.
```

*Hold the remote to the same bounds as a local admin.* `distributedLodgeSchema` in
that file caps every field to exactly the bounds the club's own officer is held
to, and the comment explains why: trusting the remote *more* than the local admin
is the inversion. Apply the same reasoning — the server caps `content` at 4000 and
`authorName` at 200, so the client's pull schema does too, and rows that break the
bounds are dropped rather than aborting the batch.

One thing to add that the lodges code does not need: **log the dropped count**.
With a forward cursor, a dropped row is not retried — the cursor moves past it and
it is gone. Silent dropping would turn a server-side bug into permanently missing
posts that nobody notices.

**2 · Local mirror tables.** Two models in the client's own schema, storing the
serialised shape as received — no `authorEmail`, because the server never sends it:

```prisma
model CommsPost {
  // The ServerNZ post id, not a local cuid — it is the sync key.
  id           String   @id
  clubName     String
  clubCode     String
  authorName   String
  // Non-null only for this club's own posts; drives "hide the flag on mine".
  authorUserId String?
  content      String
  postedAt     DateTime
  // Server's updatedAt for this row. Not used as the cursor — the cursor is
  // stored once on ServerNzSettings — but useful for debugging drift.
  syncedAt     DateTime
  images       CommsPostImage[]
}
```

A `removed` change deletes the local row outright. There is nothing to keep: the
server sent no content with it, and the member must not see it again.

**3 · `ServerNzSettings.commsCursor`.** `otherLodgesCursor` is `VarChar(64)`, and
`servernz-api.ts` carries a comment about exactly why that matters: an over-long
cursor raises P2000 *after* the rows are written and *before* the cursor advances,
so every subsequent run re-fetches and re-fails, permanently. Give `commsCursor`
the same treatment — `VarChar(64)` on the column and `.max(64)` in the response
envelope schema, so an oversized value is rejected at parse time rather than at
write time.

**4 · `src/lib/servernz-comms-sync.ts`**, modelled on
`servernz-other-lodges-sync.ts`. One pass:

1. Read `commsCursor`. Subtract **60 seconds** before sending it — see the
   commit-order trap in §7. Upserts are idempotent, so the overlap costs nothing.
2. Call `pullCommsFeed(cursor)`.
3. If the stored cursor is older than the response's `tombstoneHorizon`, **discard
   the entire local mirror and resync from scratch** with no `since`. The club has
   been offline long enough to have missed removals it can never catch up on;
   carrying the old rows forward would leave deleted posts on screen indefinitely.
4. Apply changes: `visible` upserts, `removed` deletes.
5. Apply `retentionDays` locally — delete mirrored posts older than the window.
6. Advance `commsCursor`. Loop while `hasMore`.

Steps 4 and 6 belong in one transaction per page, so a crash mid-page cannot
advance the cursor past changes that were not applied.

**5 · The claim and the cron.** Add a second claim beside
`withOtherLodgesSyncClaim` — the same status-guarded `updateMany`, a separate
column so a comms pass and a lodges pass never block each other. Then call it from
`src/app/api/cron/alpine-server-sync/route.ts`, which already exists and already
runs on the right schedule.

A daily pass is too slow for a conversation. Something in the 5–15 minute range
fits a feed people talk on, and is the one number worth deciding deliberately
rather than inheriting from the lodges sync.

**6 · Write proxies.**

```ts
// src/app/api/comms/posts/route.ts
const session = await auth()
if (!session?.user) return unauthorized()

// Author identity comes from the SESSION, never from the request body.
// ServerNZ cannot verify these fields (decision 04) — it trusts this club's
// key. That trust is only warranted if the values are taken from a real
// authenticated session here. Accepting them from the client would make any
// member able to post under any name, network-wide.
await createCommsPost({
  authorUserId: session.user.id,
  authorName:   session.user.name,
  authorEmail:  session.user.email,
  content, scope, images,
})
```

The report route is the same shape: `reporter_user_id` from `session.user.id`,
never from the body. Return the server's `{ status, hidden }` to the browser so
the UI can show a "Reported" state.

**7 · Images — do not hotlink the capability URLs.** Pointing `<img src>` straight
at ServerNZ sends every member's IP address to the central server, spreads the
unguessable URLs into browser history and referrer headers across every club, and
breaks all images whenever ServerNZ is down. Proxy them through the client's
existing `/api/images` namespace, keyed by the mirrored post id and image index so
the ServerNZ URL never reaches the browser. Text still renders when the central
server is unreachable; only the images go missing, which is the right way round.

Caching the bytes locally is the fully-offline alternative. It costs one copy per
club per image — reasonable at this scale, but a real multiplier, so make it a
decision rather than a default.

**8 · Where it appears.** A route of its own under `(authenticated)`, with a nav
entry beside Recent News — not merged into it. `(authenticated)/notices` is
club-internal, admin-authored and read-tracked; this is member-authored and
cross-club. Folding one into the other would put unmoderated content from other
clubs into a club's own official notices stream.

Gate it on a new `modules.commsPortal` flag through the existing
`loadEffectiveModuleFlags()`, exactly as the notices page gates on
`modules.memberNotices`. A cross-club social feed is not something every club will
want, and that opt-out already exists.

The pieces are all in that repo already: Radix dialog for the report modal,
`sonner` for confirmation toasts, `photoswipe` for the image lightbox, `date-fns`
and `formatNZDate` for timestamps. Nothing new is needed.

### Two things the UI must say out loud

- **The size budget.** Up to 4 images but **9 MB combined**. Show a running total
  and block the send client-side — a server-side rejection arrives from Caddy as a
  bare 413 with no JSON body, which cannot be turned into a useful message.
- **Posts cannot be retracted.** There is no member delete endpoint (decision 05).
  A member who posts by mistake needs a ServerNZ admin, and the post stays live in
  every connected club's feed until they get one. Whatever contact route is
  expected belongs in the composer's help text, not in an email nobody knows to
  send.

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
8. `GET /api/v1/feed/sync` — the mirroring cursor, removals included.
9. `POST /api/v1/posts/[id]/report`.
10. Admin API routes, then the `/posts` (three tabs) and `/settings` pages, then
    `proxy.ts` and `ConsoleShell`.
11. `post-cleanup.ts` + `instrumentation.ts` + the manual trigger.
12. Compose, Dockerfile, env and README. (No Caddyfile change in rev C.)

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
| `…/api/v1/__tests__/feed-sync-route.test.ts` | Hidden and purged posts appear as `state: "removed"` carrying no content; `CLUB_ONLY` removals reach only the owning club; a page boundary splitting one `updatedAt` loses no row and does not loop; a cursor older than the horizon reports full-resync |
| `…/api/v1/__tests__/feed-route.test.ts` | Scope filtering; hidden and deleted excluded; keyset paging across same-millisecond posts |
| `…/api/v1/__tests__/post-report-route.test.ts` | **Two reports do not hide; the third does**; three from one club is enough; duplicate returns 200 without recounting; `autoHideExempt` post never hides; cross-club `CLUB_ONLY` report → 404 |
| `…/api/v1/__tests__/posts-route.test.ts` | Scope enforcement; >4 images rejected; failed image processing leaves no orphaned files or rows |
| `…/api/admin/__tests__/posts-admin-route.test.ts` | Non-ADMIN session rejected on every route; unhide dismisses reports and zeroes the count; `{ exempt: true }` survives a fresh round of reports; hard delete unlinks files |
| `src/lib/__tests__/post-cleanup.test.ts` | Retention `0` is a no-op; posts under review skipped; purged stubs pruned only past the horizon; a stale claim is reaped; a held claim makes the run a no-op; orphan sweep collects; stats accurate |

**The three worth writing first:** the 2-vs-3 threshold boundary, the
duplicate-report case, and the `autoHideExempt` override. Together they pin down
the entire auto-hide contract.

---

*Rev C — decisions 01–07 settled and applied; mirroring, removal propagation and
the corrected cleanup claim added after reading the booking client. Drafted
against `AlpineClubServerNZ@c687b4f` on `main`; line references such as
`Caddyfile:27`, `src/proxy.ts:16` and `Dockerfile:52` are accurate as at that
commit. Client-side references are to `AlpineClubBookingsNZ` as it stands
alongside it.*
