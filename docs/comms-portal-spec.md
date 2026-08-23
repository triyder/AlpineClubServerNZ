# Communication Portal — implementation spec

**Status:** ready to build · **Rev D** · 22 Aug 2026
**Supersedes:** the original "multi-club Communication Portal" brief, and spec rev A–C
**Migration:** `0004_posts`
**Rendered copy:** https://claude.ai/code/artifact/5a28de3b-4d65-44a6-ae57-c1648f800c24

A club message board that can reach beyond one club. Posts stay in the club that
wrote them unless a member ticks *share with all clubs* — then, and only then,
they travel through AlpineClubServerNZ to every connected club.

Two repositories are involved. AlpineClubBookingsNZ owns the feature; ServerNZ is
a distribution hub for the subset that is deliberately shared.

---

## 1. Where posts live

```
LOCAL POST  (the default)
  Written in BookingsNZ, stored in BookingsNZ, shown only to that club.
  ServerNZ never sees it. No API call, no upload, no image transfer.

SHARED POST  ("share with all clubs" ticked)
  Written in BookingsNZ, stored in BookingsNZ  ← still the club's own record
                       + uploaded to ServerNZ  ← distribution copy
                       + mirrored to every other club

MIRRORED POST  (another club's shared post)
  Pulled from ServerNZ into BookingsNZ on the sync pass. Read-only content:
  this club may hide or remove its local copy, but must never edit it.
```

### What this buys

- **Private club chatter stays private** — not as a scope filter that a bug could
  invert, but because the data is never transmitted at all. This is the strongest
  form the guarantee can take.
- **ServerNZ gets much smaller.** Only deliberately-shared posts and their images
  cross the network, which eases the 9 MB upload budget, the disk volume, and the
  moderation load at once.
- **Scope filtering disappears.** Every post ServerNZ holds is a network post, so
  the `PostScope` enum, the `scope` column and every scope predicate in the feed
  and sync queries are deleted. The "a `CLUB_ONLY` removal leaks post ids" hazard
  from rev C goes with them.
- **Less member data leaves the club.** ServerNZ no longer returns `authorUserId`
  to anyone — the authoring club already holds the canonical row.

### The rule that makes shared posts work

A club's own shared post exists twice: as the local row it wrote, and as the
ServerNZ copy that comes back on the next sync. Rendering both would double it in
the feed. So on every sync pass:

**Skip content upserts for rows originating from your own club — but always apply
removals for them.**

The first half stops duplicates and keeps the local row canonical, so the author
sees their post instantly rather than waiting for a round trip. The second half is
how central moderation reaches back: if a ServerNZ admin takes down a shared post,
the authoring club must hear about it too, or the one club guaranteed to keep
showing it is the club that wrote it.

---

## 2. What changed

### Rev D — club-first, plus the two rev C follow-ups

1. **Posts default to the club that wrote them.** A tickbox shares one with the
   network. Local posts never touch ServerNZ, so `scope` is removed from the
   server entirely.
2. **The moderation console is duplicated in BookingsNZ**, over a single local
   table holding both own and mirrored posts, with edit rights that differ by
   origin.
3. **Any member may share; a club admin may un-share.** Un-share deletes the
   network copy and keeps the local one.
4. **Retention prunes via tombstone**, not silent deletion — every removal now
   travels one channel.
5. **The console shows which clubs have synced** since a takedown, so "I removed
   it" and "it is actually gone" stop being the same claim.

### Against the original brief

| Brief said | This spec says | Because |
| --- | --- | --- |
| One feed, scope chosen per post on the server | Club-local by default; sharing is an upload | A post that is never transmitted cannot leak through a filter bug. |
| Express routes + `express.static` | App Router route handlers; images streamed by a handler | No Express in either repo. Next only serves `public/` content present at build time. |
| Save to `public/uploads/posts/` | Write to `UPLOADS_DIR` on a named Docker volume | The Dockerfile bakes `public/` into the image — runtime writes vanish on rebuild. |
| `X-Club-API-Key` header | Existing `authenticateApiRequest()` + `posts:*` scopes | Auth, revocation, club approval and `lastUsedAt` are already solved in `api-auth.ts`. |
| "Server Super Admins" | `requireAdmin()` on ServerNZ; the club's own admin role in BookingsNZ | There is no Super Admin. ADMIN is the only role ServerNZ uses. |
| UUID primary keys | `@default(cuid())` | Every existing model in both repos uses cuid. |
| `is_hidden` / `is_deleted` booleans | `hiddenAt` / `removedAt` timestamps + `removedBy` | A moderation queue needs to know *when* and *by whom*, not just whether. |
| Auto-hide at 5 reports | 3, network-side; clubs set their own local threshold | Decision 01. Reversible via the Hidden tab and `autoHideExempt`. |
| Dismiss sets `report_count = 0` | Dismiss stamps `dismissedAt` on open reports | Zeroing the count while report rows persist desynchronises the queue and permanently bars past reporters. |
| 10 MB per image, 4 images | 4 images, **9 MB combined**, shared posts only | Caddy's 10 MB body cap stays. Local posts are bounded by the club's own limits. |
| Real-time push (SSE) | Cursor sync on the client's existing cron | The browser never talks to ServerNZ, so a held-open connection per install buys nothing a poll does not. |
| Cron "daily at 02:00 UTC" | Explicit `{ timezone: "UTC" }` + a status-guarded claim | The container sets `TZ=Pacific/Auckland`, so the naive schedule fires ~12 hours early. |

---

## 3. Settled decisions

**01 · Report trust.** 3 open reports from any club auto-hides a *network* post.
Reversible from the Hidden tab, with `autoHideExempt` to stop a targeted post
re-hiding forever. Applied as `auto_hide_threshold = 3`,
`auto_hide_min_clubs = 1`. Local posts are moderated entirely by their own club,
on its own threshold.

**02 · Who moderates.** On ServerNZ: ADMIN only, via a new `requireAdmin()`. No
moderator tier. In BookingsNZ the club's existing admin role governs the local
screens.

**03 · Image access.** Capability URLs — a 128-bit random `publicId` per image,
unguessable but not authorised. Applies only to shared images.

**04 · Author identity.** BookingsNZ is authoritative: author fields come from the
next-auth session, never from a form field. ServerNZ stores them for moderation
but **returns `authorUserId` to nobody**.

**05 · Who can delete.** *Revised in rev D* — three principals, not two:

- **Members** — cannot delete. Unchanged.
- **The owning club's admin** — may delete or un-share *their own club's* network
  posts, and may remove any mirrored post from their own club's feed.
- **The ServerNZ admin** — may remove anything on the network.

The middle principal is new. Without it a club retracts a post locally and every
other club keeps showing it.

**06 · Retention.** 12 months on the network, skipping posts under moderation.
Clubs set their own retention for local posts; mirrored posts prune at whichever
window is shorter, so a club can be stricter than the network but never laxer.

**07 · Audit attribution.** A nullable `userId` on `AuditLog` so every moderation
entry names the admin who acted. Purely additive; ships in `0004_posts`.

**08 · Scope leaves the server.** With club-only posts never uploaded, every post
ServerNZ holds is a network post. The `PostScope` enum, the `scope` column and all
scope filtering are removed rather than left as dead branches that look like they
still protect something.

**09 · Who can share.** **Any member may tick the box**; the post uploads
immediately. The club admin's screen badges shared posts and offers
**Un-share** — delete the network copy, keep the local one. The trade to hold on
to: a post is network-wide before anyone reviews it. Un-share is the remedy, so it
has to be one click from the moderation list, not buried.

### Dead roles on ServerNZ — noted, not touched

The `Role` enum still contains `MANAGER` and `USER`, and `requireManager()` is
still called by five existing files. Nothing ever creates a non-ADMIN user — the
seed only makes ADMIN — so both are effectively dead. This spec leaves them alone
and does not use them. Removing them is a clean, separate tidy-up.

---

## 4. Trust model

**Server-derived, never accepted from the client**

- `clubId` on a post and `reporterClubId` on a report — from the authenticated
  token.
- `hiddenAt`, `removedAt`, `reportCount` — server state only.
- Image storage paths — generated server-side; the client never supplies or sees a
  filesystem path.

**Club-asserted, trusted but unverifiable**

- `authorName`, `authorUserId`, `authorEmail`, `reporterUserId`

ServerNZ trusts the posting club's key. That trust is only warranted because
BookingsNZ takes these values from an authenticated session rather than the
request body (§12). A club whose install is modified can post under any name, and
no server-side check can catch it.

### What a 3-report threshold means

`reporterUserId` is a client-supplied string, so one club's key can manufacture
three reports with three invented member IDs and hide any network post. The
threshold is the whole control.

The Hidden tab is what makes that workable: auto-hide is a queue signal, not a
verdict — fast, cheap, fully reversible. Three things hold it up, all built below:
the Hidden tab is the admin's working surface with a nav count badge; reports are
rate-limited to 20/min per token and land in the audit log; and `autoHideExempt`
stops an unhidden post re-hiding at the next three reports, indefinitely.

If abuse appears, raise `auto_hide_min_clubs` from 1 to 2 in the settings screen.
No code change, no migration.

### Privacy boundary

`authorEmail` is stored for moderation contact and **must never appear in any
`/api/v1` response**. `authorUserId` is likewise stored and never returned. The
split between `serializeOtherLodge` and `serializeOtherLodgeForClient` in
`src/lib/other-lodges.ts` is the pattern — two serialisers, one internal, one
client-facing.

---

## 5. ServerNZ data model

Repo conventions: camelCase Prisma fields with `@map` to snake_case columns,
`@@map` on every model, `cuid()` keys, explicit `onDelete`.

```prisma
// No PostScope enum. Every post here is a network post — club-only posts are
// never uploaded, so there is nothing to distinguish (decision 08).

enum PostHiddenBy {
  SYSTEM   // auto-hidden on reaching the report threshold
  ADMIN    // hidden by the ServerNZ admin
}

enum PostRemovedBy {
  CLUB      // the authoring club deleted or un-shared it
  ADMIN     // the ServerNZ admin removed it
  RETENTION // aged out of the retention window
}

enum ReportReason {
  SPAM
  INAPPROPRIATE
  HARASSMENT
  OTHER
}
```

```prisma
// A post a club chose to share with the network. Author fields are asserted by
// that club's install and are not independently verifiable (see Trust model).
model Post {
  id           String   @id @default(cuid())
  clubId       String   @map("club_id")
  club         Club     @relation(fields: [clubId], references: [id], onDelete: Cascade)

  // Stored for moderation. NEITHER is ever serialized to a client.
  authorUserId String   @map("author_user_id")
  authorEmail  String?  @map("author_email") @db.VarChar(320)
  // The one author field clients DO receive — it is what readers see.
  authorName   String   @map("author_name")  @db.VarChar(200)

  content      String   @db.VarChar(4000)

  // Cached count of NON-dismissed reports. Recomputed on every report and on
  // dismissal, never blind-incremented.
  reportCount  Int      @default(0) @map("report_count")

  hiddenAt     DateTime?     @map("hidden_at")
  hiddenBy     PostHiddenBy? @map("hidden_by")

  // Reviewed and cleared: the threshold must never auto-hide it again.
  autoHideExempt Boolean @default(false) @map("auto_hide_exempt")

  // Removal. Content is blanked and image files unlinked AT ONCE; what remains
  // is a stub carrying id/clubId/timestamps, which IS the tombstone that tells
  // mirroring clubs to drop their copy. Pruned once the horizon passes.
  removedAt    DateTime?      @map("removed_at")
  removedBy    PostRemovedBy? @map("removed_by")

  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt      @map("updated_at")

  images  PostImage[]
  reports PostReport[]

  // Browse feed: (createdAt DESC, id DESC).
  @@index([createdAt(sort: Desc), id(sort: Desc)])
  // Mirroring cursor: GET /api/v1/feed/sync orders by (updatedAt, id) ASC.
  @@index([updatedAt, id])
  @@index([clubId])
  @@index([reportCount])
  @@index([hiddenAt])
  // Retention sweeps the stubs by removedAt.
  @@index([removedAt])
  @@map("posts")
}
```

**One removal column, not three.** Rev C carried `hiddenAt`, `deletedAt` and
`purgedAt`. Hidden is genuinely different — reversible, content intact, awaiting a
decision — so it stays. But "soft deleted" and "purged" collapsed once retention
started emitting tombstones too: delete, un-share and age-out now do exactly the
same thing to the row and differ only in *who* caused it. That is a `removedBy`
enum, not three nullable timestamps whose valid combinations nobody can remember.

```prisma
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

  // Dismissed rows stay for the audit trail but stop counting toward
  // reportCount and the auto-hide threshold.
  dismissedAt    DateTime?    @map("dismissed_at")
  createdAt      DateTime     @default(now()) @map("created_at")

  // Club-scoped: member ids are unique within a club, not across clubs.
  @@unique([postId, reporterClubId, reporterUserId])
  @@index([postId])
  @@map("post_reports")
}
```

```prisma
model SystemSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("system_settings")
}

// Single-flight claim for scheduled jobs. See §10 for why this rather than a
// Postgres advisory lock.
model JobClaim {
  name      String    @id
  startedAt DateTime? @map("started_at")

  @@map("job_claims")
}

// --- add to the existing Club model -------------------------------------
  posts       Post[]
  postReports PostReport[] @relation("PostReportClub")
  // Stamped by GET /api/v1/feed/sync ONLY. Distinct from ApiToken.lastUsedAt,
  // which any authenticated call bumps: this answers "has this club actually
  // pulled the feed since I removed that post?", which lastUsedAt cannot.
  lastCommsSyncAt DateTime? @map("last_comms_sync_at")

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
| `posts.tombstone_horizon_days` | int | 90 | How long a removed post's stub survives so mirrors converge. Must exceed the longest plausible club outage |

Seed these in `prisma/seed.ts` alongside the existing idempotent admin seed,
together with the `posts.cleanup` `JobClaim` row — the guarded claim never fires
if its row is absent. `src/lib/settings.ts` falls back to the same defaults so a
missing row is never fatal.

### Migration

Write `prisma/migrations/0004_posts/migration.sql` by hand to match the existing
style: plain SQL with `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey`
section comments and explicit `ON DELETE … ON UPDATE CASCADE` clauses, exactly as
`0002_other_lodges` does. Generate with `prisma migrate dev --create-only`, then
edit into shape.

---

## 6. Media pipeline

ServerNZ side only. Images on a club-local post never leave BookingsNZ and are
bounded by that club's own limits.

### Where files live

A new `UPLOADS_DIR` environment variable, defaulting to `./data/uploads` in
development and `/app/data/uploads` in the container, backed by a named volume. It
sits **outside `public/`**: the Dockerfile copies `public/` from the build stage,
so runtime writes there are destroyed on every rebuild, and Next only serves
assets present in `public/` at build time.

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
2. **Combined size next.** Sum the parts; reject over 9 MB total with a `413` that
   names the limit and the actual size.
3. **Magic bytes.** Sniff the leading bytes for JPEG (`FF D8 FF`), PNG
   (`89 50 4E 47`) or WebP (`RIFF….WEBP`). The declared `Content-Type` is not
   evidence.
4. **Decode with limits.**
   `sharp(buf, { limitInputPixels: 50_000_000, failOn: "error" })` — an unbounded
   decode is a memory-exhaustion vector regardless of file size.
5. **Resize** to fit 1920×1080, `fit: "inside"`, `withoutEnlargement: true`.
6. **Re-encode** to WebP at quality 80. Do *not* call `withMetadata()` — Sharp
   drops EXIF by default, which is what strips GPS coordinates from members' phone
   photos.
7. **Write** the derivative and record the row. The original is never persisted.

### Caddy stays at 10 MB

No `request_body` change. A typical phone photo is 3–8 MB, so in practice a shared
post carries one or two images, not four — the 4-image maximum is rarely the
binding constraint, the 9 MB budget is. Because the cap is on the *combined* size,
the composer must show a running total and block the send itself; otherwise the
failure arrives from Caddy as a bare 413 with no JSON body.

Peak memory per concurrent upload is ~10 MB rather than ~41, which matters on one
small container running Next, Prisma and Sharp together — and far fewer posts
reach it now that local ones never do.

### Blocker — sharp is not a declared dependency

It appears in `node_modules` transitively and is listed under `allowScripts`, but
not in `dependencies`. Add it explicitly, and add `"sharp"` to
`serverExternalPackages` in `next.config.ts` beside `@prisma/client` and
`bcryptjs` — it is a native module and the standalone bundle will break without
it.

---

## 7. ServerNZ API

All routes authenticate through the existing `authenticateApiRequest(req)`, which
resolves the club, rejects revoked tokens and non-`APPROVED` clubs, and stamps
`lastUsedAt`. All follow the established handler order: `clientIp` → authenticate
→ rate limit → scope check → validate → act → `recordAudit` → respond.

### Scopes

Two, mirroring the existing `lodges:read` / `lodges:write` pair:
**`posts:read`** (feed + sync) and **`posts:write`** (share, report, delete own).
Add them to the default array in `createTokenSchema` (`src/lib/validation.ts`).
Existing tokens will not carry them — either re-issue, or have the console offer a
scope top-up.

`checkRateLimit(key, now, max, windowMs)` already accepts per-call overrides, so
sharing and reporting can be limited far more tightly than the global 120/min
without touching `src/lib/rate-limit.ts`.

### `POST /api/v1/posts` — `posts:write`, 10/min

Called when a member ticks *share with all clubs* — never for a local post.
`multipart/form-data`: `author_user_id`, `author_name`, `author_email?`,
`content`, `images[]` (0–4, 9 MB combined). No `scope` field; there is nothing to
choose.

- `content`: trimmed, 1–4000 chars, stored as **plain text**.
- A failure on any image fails the whole request and unlinks anything already
  written.
- `clubId` from the token. Post and image rows created in one
  `prisma.$transaction` after all files are safely on disk.
- Returns `{ id }` — BookingsNZ stores it as `serverPostId` and needs it to
  un-share later.
- `recordAudit({ action: "post.share", … })`.

### `DELETE /api/v1/posts/[id]` — `posts:write`

**New in rev D.** The authoring club withdraws its own post from the network —
whether the club admin deleted it outright or un-shared it while keeping the local
copy. ServerNZ cannot tell the two apart and does not need to.

- **Own-club only.** `post.clubId !== club.id` returns `404`, not `403` — a club
  has no business learning which post ids belong to others.
- Blanks `content`, deletes image rows, unlinks files, sets `removedAt` +
  `removedBy: CLUB`.
- Idempotent: deleting an already-removed post returns `200`, so a retry after a
  network timeout is safe.
- `recordAudit({ action: "post.unshare", … })`.

### `POST /api/v1/posts/[id]/report` — `posts:write`, 20/min

`application/json`: `{ reporter_user_id, reason, details? }`. Only ever called for
network posts — a report on a club-local post is handled entirely inside
BookingsNZ.

```ts
const result = await prisma.$transaction(async (tx) => {
  const post = await tx.post.findFirst({
    where: { id, removedAt: null },
    select: { id: true, clubId: true, hiddenAt: true, autoHideExempt: true },
  })
  if (!post) return { status: "not-found" } as const

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
  return { status: "recorded", hidden: shouldHide } as const
})

// Nothing to push. The update bumped `updatedAt`, so the next /feed/sync pass
// from each club carries { state: "removed", reason: "hidden" }.
```

Responses: `200 { status: "recorded" | "duplicate", hidden }`, or `404` if the
post is missing or already removed. Audit action `post.report` either way.

### `GET /api/v1/feed` — `posts:read`

Backward keyset on `(createdAt, id)`, `limit` 1–50 default 20, filtering
`hiddenAt: null, removedAt: null`. Retained for a client that renders live rather
than mirroring, and useful for debugging. **BookingsNZ does not use it** — it uses
`/feed/sync`. Returns `authorName` but never `authorUserId` or `authorEmail`.

### `GET /api/images/posts/[publicId].webp` — capability URL, unauthenticated

Outside `/api/v1`, because it is not part of the authenticated client API. Looks
up `publicId`, 404s if the post is removed, streams from `resolveStorageKey()`,
and sets `Cache-Control: private, max-age=31536000, immutable` — content is
immutable per id, so a long cache is safe and a removed post's URL simply starts
404ing.

---

## 8. Mirroring

### `GET /api/v1/feed/sync` — `posts:read`

A forward cursor over `updatedAt`, mirroring the contract
`GET /api/v1/other-lodges?since=` already uses. Params: `since` (ISO 8601, omit
for a full initial sync) and `limit` (1–200, default 100).

**Stamps `Club.lastCommsSyncAt`** on every call. That is what makes takedown
confirmation possible in the console.

### Why a visible-posts feed cannot drive a mirror

Pull every post with `updatedAt > cursor` and you get creations and edits. You do
**not** get removals: a hidden or removed post simply stops matching the filter,
so the mirror never hears and keeps serving it indefinitely. Auto-hide would be
visible on ServerNZ and inert everywhere else.

### Every removal travels one channel

Rev C left a hole: admin deletes emitted a signal, but retention pruning deleted
rows silently and relied on each club applying the same window locally. Two
mechanisms for one job, and the weaker one handled the higher volume — so a club
with a bug in that code path kept content the network had expired, invisibly.

Rev D removes the split. **Retention prunes by tombstone too**: blank the content,
unlink the files, set `removedAt` + `removedBy: RETENTION`, and let the stub expire
after the horizon. Hidden, deleted, un-shared and aged-out all now reach mirrors
the same way, and `retentionDays` no longer needs advertising because nobody has
to act on it.

```jsonc
{
  "changes": [
    // A live post: full payload. No authorUserId, no authorEmail.
    { "state": "visible", "post": {
        "id": "clx…",
        "club": { "id": "clx…", "name": "Tararua Alpine Club", "code": "TAC" },
        "authorName": "Jo Whitcombe",
        "content": "Hut book from the Whitcombe trip is back at the lodge.",
        "images": [ { "url": "https://…/api/images/posts/9f2c….webp",
                     "width": 1920, "height": 1280 } ],
        "createdAt": "2026-08-22T04:11:08.221Z"
    } },

    // Removed. NO content, NO author, NO images — the mirror only needs to know
    // which row to drop. Sending the body of a post that was hidden for being
    // abusive would defeat the point of hiding it.
    { "state": "removed", "id": "clx…", "reason": "hidden" },
    { "state": "removed", "id": "clx…", "reason": "removed" }
  ],
  "cursor": { "since": "2026-08-22T04:11:08.221Z", "sinceId": "clx…" },
  "hasMore": true,
  // Oldest cursor still serviceable. A client whose stored cursor predates
  // this has missed removals it can never catch up on — it MUST discard its
  // mirror and resync from scratch rather than carry stale rows forever.
  "tombstoneHorizon": "2026-05-24T00:00:00.000Z"
}
```

A **full sync** (no `since`) returns visible posts only. A club joining the
network should not receive a year of tombstones for posts it never held.

### Three cursor traps

**Commit order, not timestamp order.** An `updatedAt` cursor assumes rows become
visible in timestamp order. They do not: a transaction stamping `updatedAt = T1`
may commit *after* one stamped `T2 > T1`. A client that advanced to `T2` never
sees the `T1` row — permanently. The fix to specify: the client re-requests with a
60-second overlap on every pass, and its upsert is idempotent so re-seeing a row
costs nothing. `servernz-other-lodges-sync.ts` has the same exposure today; the
overlap is a one-line improvement there too.

**A page boundary must not split a timestamp.** If `limit` rows share one
`updatedAt` and the next row shares it too, returning that bare timestamp as the
cursor makes the next request skip the remainder (`gt`), while re-requesting the
previous value loops forever. Page on the composite `(updatedAt, id)` and return
both parts — which is why `cursor` above is an object.

**Reports bump `updatedAt`.** Recording a report writes `reportCount`, re-sending
the post to every mirror though nothing client-visible changed. Accepted rather
than engineered around: one row, idempotent write, reports are rare.

```ts
// No hiddenAt/removedAt filter — removals are the point of this endpoint.
// Post state maps to the response `state` in the serialiser, not in the query.
// No scope predicate either: every row here is a network post (decision 08).
where: since ? {
  OR: [
    { updatedAt: { gt: since } },
    { updatedAt: since, id: { gt: sinceId } },
  ],
} : { hiddenAt: null, removedAt: null },   // full sync: visible only
orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
take: limit + 1,   // the extra row is how hasMore is computed
```

---

## 9. ServerNZ console

### Blocker — new pages are unauthenticated by default

`src/proxy.ts` gates a fixed prefix list *and* a matching `config.matcher`. A page
matching neither renders for anonymous visitors. Both lists need `/posts` and
`/settings` added — and because the proxy runs on the Edge runtime and only
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

Pages at `/posts` and `/settings`, matching the existing top-level console pages
(`/clubs`, `/lodges`, `/audit`), with links added to `ConsoleShell`. `/admin`
stays what it already is: the JSON API namespace.

| Tab | Query | Purpose |
| --- | --- | --- |
| **Hidden** | `hiddenAt != null` | The working queue. Everything auto-hidden at 3 reports lands here awaiting a human |
| **Flagged** | open reports, `reportCount` desc | Reported but still under the threshold — early warning |
| **All posts** | everything, newest first | Search across content, author and club |

### Did the takedown actually land?

Removing a post here only publishes a signal; each club acts on it at its next
sync. So the Hidden tab shows, per post, how many approved clubs have called
`/feed/sync` since it was removed:

> Removed 14 min ago · 3 of 5 clubs synced since

Counted from `Club.lastCommsSyncAt` rather than `ApiToken.lastUsedAt`, which any
authenticated call bumps and which would therefore overstate convergence. Clubs
that have not synced are listed by name, so "this is still up at Ruapehu" is a
fact an admin can see rather than guess.

### Actions — all `requireAdmin()`

| Action | Route | Effect |
| --- | --- | --- |
| List / search | `GET /api/admin/posts` | `?tab=hidden\|flagged\|all`, `?q=` over content and author, `?clubId=`, date range |
| Hide | `PATCH /api/admin/posts/[id]` | Sets `hiddenAt` + `hiddenBy: ADMIN` |
| **Override hide** | `POST /api/admin/posts/[id]/unhide` | Clears the hide, dismisses open reports, recomputes `reportCount` to 0. Optional `{ exempt: true }` sets `autoHideExempt` |
| Dismiss reports | `POST /api/admin/posts/[id]/dismiss` | Stamps `dismissedAt` on open reports and recomputes, leaving visibility as-is |
| Edit text | `PATCH /api/admin/posts/[id]` | Replaces `content`; original captured in audit metadata |
| Delete one image | `DELETE /api/admin/posts/[id]/images/[imageId]` | Row deleted, then `deleteStoredImage()` |
| Remove | `DELETE /api/admin/posts/[id]` | Blanks content, unlinks files, sets `removedAt` + `removedBy: ADMIN`. The stub becomes the mirror tombstone. Not recoverable — confirm in the UI |
| Settings | `GET\|PUT /api/admin/settings` | Retention, threshold, minimum clubs, tombstone horizon |
| Run cleanup now | `POST /api/admin/settings/cleanup` | Invokes the same function the cron calls; returns the stats block |

**Dismiss, done properly.** The brief's "reset `report_count = 0`" leaves the
count disagreeing with the rows it summarises, keeps stale reasons on screen, and
— because of the unique constraint — permanently bars everyone who already
reported from ever reporting again. Stamping `dismissedAt` keeps the history
visible, lets the count be recomputed from truth, and leaves the post genuinely
re-reportable by a fresh set of members.

Each row shows author name and club, post age, open report count, a per-reason
breakdown (`groupBy` on `reason` where `dismissedAt is null`), the reporting clubs,
and every `details` note. An auto-hidden post and an admin-hidden one must be
distinguishable at a glance — only the former is asking for a decision.

Every action calls `recordAudit()` with the acting admin: `post.hide`,
`post.unhide`, `post.exempt`, `post.dismiss`, `post.edit`, `post.image.delete`,
`post.remove`, `settings.update`, `posts.cleanup`.

### Revoke a key only after the club has synced

Revoking a club's API token freezes its mirror with whatever it already holds. If
you revoke in order to cut a club off from content you are also removing, you
guarantee they never receive the removal — the opposite of the intent. Remove
first, confirm on the Hidden tab that the club has synced since, then revoke.
Worth putting in the confirm dialog on the token-revoke screen, not only in this
document.

---

## 10. Retention

### Blocker — two scheduling traps

**Timezone.** The Dockerfile sets `TZ=Pacific/Auckland`. `node-cron` uses the
process timezone by default, so `"0 2 * * *"` fires at 02:00 NZT — roughly 14:00
UTC, half a day from where the brief intends. Pass `{ timezone: "UTC" }`
explicitly.

**No startup hook.** A Next standalone server has nowhere to start a scheduler.
Add `src/instrumentation.ts` with a `register()` export, guarded on
`process.env.NEXT_RUNTIME === "nodejs"` so it does not also run in the Edge
runtime or under `next dev` reloads.

### Correction — rev B's advisory lock was wrong

Rev B specified `pg_try_advisory_lock` through `prisma.$queryRaw`. The booking
client's `src/lib/servernz-sync-claim.ts` documents why that fails under Prisma,
having hit it already: a **session-scoped** lock is taken and released through the
connection *pool*, so the unlock can execute on a different connection than the
lock — the lock never releases and the job is wedged until the pool recycles,
silently. An **xact-scoped** `pg_advisory_xact_lock` releases at commit, so
covering the pass would mean holding a transaction open across file I/O.

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

Seed the `posts.cleanup` row — the guarded `updateMany` matches nothing if the row
is absent, so a missing row reads as "permanently held" and the job never runs.

### The pass, in order

1. Read `posts.retention_days`. `0` → return `{ skipped: "disabled" }`.
2. **Expire.** For posts with `createdAt < cutoff` and `removedAt: null`,
   **excluding any with open reports**: blank `content`, delete image rows, unlink
   files, set `removedAt` + `removedBy: RETENTION`. A post in the Hidden or
   Flagged queue is evidence — expiring it destroys the case before anyone has
   ruled on it. Count and log the exclusions.
3. **Prune stubs.** Delete rows where `removedAt < now − tombstone_horizon_days`.
   These already carry no content or files; they exist only to tell mirrors to
   drop their copy, and every mirror that is going to hear has heard.
4. Sweep `UPLOADS_DIR` for files older than 24 hours with no matching `PostImage`
   row — this also collects derivatives from uploads whose transaction later
   rolled back.
5. `recordAudit({ action: "posts.cleanup", metadata: stats })`.

**Two steps, because expiry is not deletion.** Rev C deleted expired rows outright
and left mirrors to apply the window themselves. Splitting into expire-then-prune
costs one extra pass over an indexed column and buys the thing that was missing:
**retention now propagates by the same mechanism as every other removal.** A club
is no longer trusted to expire content on its own — it is told to, explicitly, and
the console can show whether it heard.

Order matters within step 2 as well: blank the row first, unlink files second. If
the process dies between them, orphaned files remain, which the step-4 sweep
reclaims and no user ever sees. The reverse order leaves rows pointing at missing
files — broken images, visibly and permanently.

Return and log
`{ expired, stubsPruned, imagesDeleted, filesUnlinked, skippedUnderReview, orphansCollected, durationMs }`
— exactly what `/settings` shows after a manual run.

---

## 11. Infrastructure

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
| `Caddyfile` | **No change.** Rev B needed `flush_interval -1` for SSE; with SSE gone the file is untouched and the 10 MB body cap stands |
| `next.config.ts` | Add `"sharp"` to `serverExternalPackages` |
| `package.json` | Add `sharp` and `node-cron` to `dependencies`; `@types/node-cron` to dev |
| `src/proxy.ts` | `/posts` and `/settings` in *both* `PROTECTED_PREFIXES` and `config.matcher` |
| `src/lib/admin-guard.ts` | Add `requireAdmin()` |
| `prisma/seed.ts` | Seed the four `SystemSetting` rows and the `posts.cleanup` `JobClaim` row |
| `.gitignore` | `/data` |
| `.env.example` | `UPLOADS_DIR`, documented like the existing entries |
| `README.md` | Note the new volume, and that uploads are on local disk — a second app replica would break the rate limiter and image serving alike |

---

## 12. Client: feed & sharing

AlpineClubBookingsNZ. Separate repository, not built as part of this work — but
not a blank contract either: that repo already has `servernz-api.ts`, a
cursor-based `servernz-other-lodges-sync.ts`, a single-flight
`servernz-sync-claim.ts` and an `/api/cron/alpine-server-sync` route. This extends
them rather than inventing a second way of talking to the same server.

### Local model

**One table for both own and mirrored posts.** That is what lets a single
moderation screen cover everything, and it is why `id` is a local cuid with the
ServerNZ id held separately rather than used as the key:

```prisma
model ClubPost {
  id           String   @id @default(cuid())

  // Origin. NULL = written by this club. Non-null = mirrored from ServerNZ,
  // which also means the content is READ-ONLY here (see §13).
  originClubCode String?
  originClubName String?

  // Sharing. Both null for a local post; both set once it is on the network.
  // serverPostId is what DELETE /api/v1/posts/:id needs in order to un-share.
  sharedAt     DateTime?
  serverPostId String?  @unique

  // From the next-auth session at compose time, never from a form field.
  authorUserId String?    // null on mirrored posts — never sent by ServerNZ
  authorName   String

  content      String
  postedAt     DateTime

  // Local moderation, independent of the network's.
  hiddenAt     DateTime?
  removedAt    DateTime?
  reportCount  Int      @default(0)

  images  ClubPostImage[]
  reports ClubPostReport[]

  @@index([postedAt(sort: Desc)])
  @@index([originClubCode])
  @@index([sharedAt])
}
```

### Composing and sharing

1. Member writes a post. **The share tickbox is off by default.**
2. The local `ClubPost` row is written first, always. The post is live for the
   club immediately, whether or not it is shared.
3. If ticked: call `createCommsPost(...)`, store the returned id as
   `serverPostId` and stamp `sharedAt`.
4. If the upload fails, **keep the local post and surface the failure** — do not
   roll back. Losing what someone wrote because a remote server was down is the
   wrong trade. Offer "Share" as a retry action on the post itself.

```ts
// src/app/api/comms/posts/route.ts
const session = await auth()
if (!session?.user) return unauthorized()

// Author identity comes from the SESSION, never from the request body.
// ServerNZ cannot verify these fields (decision 04) — it trusts this club's
// key. That trust is only warranted because they are taken from a real
// authenticated session HERE. Accepting them from the browser would make any
// member able to post under any name, network-wide.
const local = await prisma.clubPost.create({ data: {
  authorUserId: session.user.id,
  authorName:   session.user.name,
  content, images,
} })

if (shareWithAllClubs) {
  const { id } = await createCommsPost({
    authorUserId: session.user.id,
    authorName:   session.user.name,
    authorEmail:  session.user.email,
    content, images,
  })
  await prisma.clubPost.update({
    where: { id: local.id },
    data: { serverPostId: id, sharedAt: new Date() },
  })
}
```

### The sync pass — `src/lib/servernz-comms-sync.ts`

Modelled on `servernz-other-lodges-sync.ts`:

1. Read `commsCursor`; subtract 60 seconds before sending it. Upserts are
   idempotent, so the overlap costs nothing.
2. Call `pullCommsFeed(cursor)`.
3. If the stored cursor predates the response's `tombstoneHorizon`, **discard the
   entire mirror and resync from scratch** with no `since`. The club has been
   offline long enough to have missed removals it can never catch up on.
4. Apply changes. **For rows whose club is this club:** ignore `visible` (the
   local row is canonical — applying it would duplicate the post), but **always
   apply `removed`**, clearing `serverPostId` and `sharedAt` so the local copy
   survives as an unshared post and the UI can show that the network copy is gone.
   For every other club's rows: upsert on `visible`, delete on `removed`.
5. Prune mirrored posts past the club's own retention window, if it is shorter
   than the network's.
6. Advance `commsCursor`. Loop while `hasMore`.

Steps 4 and 6 belong in one transaction per page, so a crash mid-page cannot
advance the cursor past changes that were not applied.

### Size the cursor column deliberately

`otherLodgesCursor` is `VarChar(64)`, and `servernz-api.ts` documents exactly why
that matters: an over-long cursor raises P2000 *after* the rows are written and
*before* the cursor advances, so every subsequent run re-fetches and re-fails,
permanently. Give `commsCursor` the same treatment — the column capped, and
`.max(64)` in the envelope schema so an oversized value is rejected at parse time
rather than at write time.

### `src/lib/servernz-api.ts` additions

```ts
export async function pullCommsFeed(since?: string | null): Promise<CommsPullResult>
export async function createCommsPost(input: CommsPostInput): Promise<{ id: string }>
export async function deleteCommsPost(serverPostId: string): Promise<void>
export async function reportCommsPost(
  serverPostId: string, input: CommsReportInput,
): Promise<{ status: "recorded" | "duplicate"; hidden: boolean }>

// createCommsPost sends multipart/form-data, so it CANNOT use authHeaders() —
// that sets Content-Type: application/json, which would break the boundary.
// Pass a FormData body and let fetch set the header, keeping only Authorization.
```

Reuse `resolveConnection()`, `readError()` and `REQUEST_TIMEOUT_MS` unchanged.
Hold the remote to the same bounds a local officer is held to —
`distributedLodgeSchema` in that file explains why, and the reasoning carries
over: `content` capped at 4000, `authorName` at 200, rows breaking the bounds
dropped rather than aborting the batch.

One addition the lodges code does not need: **log the dropped count**. With a
forward cursor a dropped row is not retried — the cursor moves past it and it is
gone. Silent dropping would turn a server bug into permanently missing posts
nobody notices.

### Scheduling

Add a second claim beside `withOtherLodgesSyncClaim` — same status-guarded
`updateMany`, separate column, so a comms pass and a lodges pass never block each
other. Drive it from `src/app/api/cron/alpine-server-sync/route.ts`, which already
exists.

A daily pass is too slow for something people converse on. **5–15 minutes** fits,
and it is the one number worth choosing deliberately rather than inheriting from
the lodges sync — it is also your takedown latency.

### Images — do not hotlink the capability URLs

Pointing `<img src>` straight at ServerNZ sends every member's IP to the central
server, spreads the unguessable URLs into browser history and referrer headers
across every club, and breaks all images whenever ServerNZ is down. Proxy them
through the existing `/api/images` namespace, keyed by the local post id and image
index so the ServerNZ URL never reaches the browser. Text still renders when the
central server is unreachable; only images go missing, which is the right way
round.

### Where it appears

Its own route under `(authenticated)`, with a nav entry beside Recent News — not
merged into it. `(authenticated)/notices` is club-internal, admin-authored and
read-tracked; this is member-authored and partly cross-club. Folding one into the
other would put another club's content into this club's official notices stream.

One feed, mixed, with a club badge on anything not local — plus a filter for
members who only want their own club. Gate the whole feature on a new
`modules.commsPortal` flag through `loadEffectiveModuleFlags()`, exactly as the
notices page gates on `modules.memberNotices`.

The pieces are already in that repo: Radix dialog for the report modal, `sonner`
for toasts, `photoswipe` for the lightbox, `date-fns` and `formatNZDate` for
timestamps. Nothing new is needed.

---

## 13. Client: moderation & archive

The ServerNZ console duplicated in BookingsNZ, over the club's own `ClubPost`
table. Same shape, same tabs, same vocabulary — a club admin who has seen one
should recognise the other. What differs is that this screen holds two kinds of
row, and they are not equally editable.

### Origin decides the verbs

| Action | Own post | Mirrored post |
| --- | --- | --- |
| Edit text | Yes | **No** |
| Delete an image | Yes | **No** |
| Hide from this club's feed | Yes | Yes |
| Remove from this club | Yes | Yes |
| Un-share from the network | Yes, if shared | n/a |
| Report to ServerNZ | n/a | Yes |

Editing another club's post while still showing their name and club badge on it
would misrepresent them to this club's members. Local removal is always available
and says what it actually is; local editing is not, at any privilege level.

Removing a mirrored post locally does not remove it anywhere else, and the UI
should say so — "Hidden for our members. Still visible at other clubs." To get it
off the network, report it, or contact the ServerNZ admin.

### Tabs

| Tab | Contents |
| --- | --- |
| **Flagged** | Local posts with open reports, highest first. The club's own queue, on its own threshold |
| **Hidden** | Anything hidden locally, own or mirrored, showing which |
| **Shared** | This club's posts that are on the network. Where Un-share lives — one click, per decision 09 |
| **All posts** | Everything, searchable by content, author, club and date |

### Un-share

```ts
// Call ServerNZ FIRST. If it fails, nothing local has changed and the admin
// can retry. Clearing the local fields first would strand serverPostId — the
// only handle by which the network copy can ever be withdrawn.
await deleteCommsPost(post.serverPostId)

await prisma.clubPost.update({
  where: { id: post.id },
  data: { serverPostId: null, sharedAt: null },
})
// The local post survives, now unshared. "Share" reappears as an action.
```

Deleting a shared post outright is the same call followed by a local removal
instead of an un-share. Same order, same reasoning.

### Reports

- **On a local post** — recorded in `ClubPostReport`, counted against the club's
  own threshold, surfaced on the Flagged tab. Never leaves the club.
- **On a mirrored post** — sent to ServerNZ via `reportCommsPost(...)`, where it
  counts toward the network threshold of 3. Also recorded locally so this club's
  admin can act immediately rather than waiting for a network decision, and so a
  member's report is visibly acknowledged.

### Archive settings

A local settings panel mirroring ServerNZ's: retention period for the club's own
posts, local auto-hide threshold, and Run cleanup now. Two rules keep it coherent
with the network:

- **Local posts** use the club's own window, whatever it chooses — this content is
  nobody else's business.
- **Mirrored posts** expire at whichever window is shorter, the club's or the
  network's. A club may be stricter than the network but never laxer, and in
  practice the network usually removes them first via tombstone.

Run the local cleanup under a claim, as on the server, so the manual button cannot
race the scheduled pass.

---

## 14. Build order

Two repos. ServerNZ first — the client needs something to talk to.

### ServerNZ

1. Schema additions + hand-written `0004_posts` migration + seeded settings and
   job claim.
2. `requireAdmin()`; `src/lib/settings.ts`.
3. `src/lib/posts.ts` — select objects, both serialisers, zod schemas. Mirrors
   `other-lodges.ts`.
4. `src/lib/uploads.ts` + the sharp pipeline. Testable in isolation with fixture
   images.
5. `GET /api/images/posts/[publicId]` — proves storage end to end before any
   writes exist.
6. `POST /api/v1/posts`, `DELETE /api/v1/posts/[id]`, `GET /api/v1/feed`.
7. `GET /api/v1/feed/sync` + `Club.lastCommsSyncAt`.
8. `POST /api/v1/posts/[id]/report`.
9. Admin API, the `/posts` and `/settings` pages, `proxy.ts`, `ConsoleShell`.
10. `post-cleanup.ts` + `instrumentation.ts` + the manual trigger.
11. Compose, Dockerfile, env, README.

### BookingsNZ

1. `ClubPost` / `ClubPostImage` / `ClubPostReport` + migration;
   `modules.commsPortal`.
2. Local feed and composer, share tickbox **off by default** — entirely local, no
   ServerNZ calls yet. Shippable on its own.
3. Local moderation screens and archive settings, own-posts only.
4. `servernz-api.ts` additions + `commsCursor`.
5. Share on tick, un-share, delete propagation.
6. `servernz-comms-sync.ts` + the claim + the cron entry.
7. Mirrored posts in the feed and in moderation; the image proxy.
8. Reporting, local and network.

**A real shipping seam.** BookingsNZ steps 1–3 are a complete club message board
with moderation and archiving, touching ServerNZ not at all. That is a genuinely
useful release on its own, and it lets the local half be used and corrected before
any cross-club traffic exists. Steps 4–8 then turn on sharing.

On the ServerNZ side the equivalent caution from rev C still holds: steps 1–8
leave posts that can be auto-hidden with no console to review them. Step 9 is not
optional if step 8 ships.

---

## 15. Test plan

Vitest, co-located in `__tests__`, matching the existing layout in both repos.

### ServerNZ

| File | Covers |
| --- | --- |
| `src/lib/__tests__/posts.test.ts` | Client serialiser emits `authorName` and omits `authorUserId` and `authorEmail`; zod bounds |
| `src/lib/__tests__/uploads.test.ts` | Magic-byte rejection of a renamed non-image; combined size over 9 MB rejected; traversal keys throw; `ENOENT` unlink is a no-op; EXIF absent from output |
| `…/api/v1/__tests__/posts-route.test.ts` | >4 images rejected; failed processing leaves no orphaned files or rows; `DELETE` on another club's post returns 404; `DELETE` twice returns 200 |
| `…/api/v1/__tests__/post-report-route.test.ts` | **Two reports do not hide; the third does**; three from one club is enough; duplicate returns 200 without recounting; `autoHideExempt` never hides |
| `…/api/v1/__tests__/feed-sync-route.test.ts` | Hidden, removed and retention-expired posts all appear as `state: "removed"` carrying no content; a full sync returns no tombstones; a page boundary splitting one `updatedAt` loses no row and does not loop; a cursor older than the horizon reports full-resync; the call stamps `lastCommsSyncAt` |
| `…/api/admin/__tests__/posts-admin-route.test.ts` | Non-ADMIN rejected on every route; unhide dismisses reports and zeroes the count; `{ exempt: true }` survives a fresh round; remove blanks content and unlinks files; the synced-club count excludes clubs whose only activity predates the removal |
| `src/lib/__tests__/post-cleanup.test.ts` | Retention `0` is a no-op; posts under review skipped; expiry sets `removedBy: RETENTION` rather than deleting; stubs pruned only past the horizon; a stale claim is reaped; a held claim makes the run a no-op |

### BookingsNZ

| File | Covers |
| --- | --- |
| `src/lib/__tests__/comms-post.test.ts` | Share defaults off; author fields come from the session and a body-supplied name is ignored; a failed upload keeps the local post and leaves it retryable |
| `src/lib/__tests__/servernz-comms-sync.test.ts` | **Own-club `visible` rows are skipped but own-club `removed` rows are applied**; a stale cursor triggers full resync; a bad row is dropped and counted, not fatal; the cursor never advances past unapplied changes |
| `…/api/comms/__tests__/moderation-route.test.ts` | Editing a mirrored post is refused at every privilege level; un-share calls ServerNZ before clearing local fields, and a ServerNZ failure leaves `serverPostId` intact |
| `src/lib/__tests__/comms-retention.test.ts` | Local posts use the club window; mirrored posts use the shorter of the two; a club window longer than the network's does not extend mirrored content |

**The four worth writing first:** the 2-vs-3 threshold boundary, the
`autoHideExempt` override, the own-club skip-content-but-apply-removals rule, and
the un-share ordering. Each encodes a decision that is easy to get subtly wrong
and that nothing else in the system will catch.

---

*Rev D — club-local by default, sharing by tickbox, moderation duplicated in
BookingsNZ; retention propagating by tombstone and takedown convergence visible in
the console. Decisions 01–09 settled and applied. Drafted against
`AlpineClubServerNZ@c687b4f` on `main`; line references such as `Caddyfile:27`,
`src/proxy.ts:16` and `Dockerfile:52` are accurate as at that commit. Client-side
references are to `AlpineClubBookingsNZ` as it stands alongside it.*
