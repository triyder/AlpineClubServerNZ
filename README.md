# AlpineClubServerNZ

Central hub connecting multiple **AlpineClubBookingsNZ** client installations.
It provides:

- an **admin web console** for oversight of linked clubs/lodges and system activity;
- a **REST API** for external booking engines to register and sync;
- **API-key issuance** so each approved lodge can authenticate its local install.

The stack mirrors the AlpineClubBookingsNZ client: **Next.js 16 (App Router) ·
React 19 · Prisma 7 · PostgreSQL 16 · Tailwind 4 / shadcn-style UI · Caddy ·
Vitest · TypeScript**, on Node 24.

---

## Architecture

```
                 ┌───────────────────────── Docker network ─────────────────────────┐
  Internet ─────▶│  web (caddy:2-alpine)  ──▶  app (Next.js)  ──▶  db (postgres:16)  │
   80 / 443      │  TLS, security headers      :3000                :5432 (internal) │
                 └──────────────────────────────────────────────────────────────────┘
        ▲                                         ▲
        │ browser (admin console)                 │ Bearer token
        │                                         │
  Admins / lodges                     AlpineClubBookingsNZ clients
```

| Service | Image                | Role                                                   |
| ------- | -------------------- | ------------------------------------------------------ |
| `db`    | `postgres:16-alpine` | Persistent data (health-checked, named volume)         |
| `app`   | built from Dockerfile | Next.js server; runs migrations + seed then serves     |
| `uploads_data` | named volume  | Communication Portal images (see below)                |
| `web`   | `caddy:2-alpine`     | Reverse proxy, automatic HTTPS, security headers        |

### Communication Portal

A cross-club message board. Posts written in a club's AlpineClubBookingsNZ
install stay in that club unless a member ticks **share with all clubs** — only
then are they uploaded here and distributed to every connected club. Club-only
posts never reach this server at all, so their privacy does not depend on a
filter here being correct.

Clubs mirror the shared feed rather than reading it live: `GET /api/v1/feed/sync`
is a forward cursor that reports removals as well as new posts, so a hidden,
withdrawn or expired post actually disappears from every club. Admins moderate
at **Posts** and tune retention at **Settings** (both ADMIN-only).

Two operational notes:

- **Images live on the `uploads_data` volume**, not in `public/` — the Dockerfile
  copies `public/` from the build stage, so anything written there would be
  destroyed on the next `docker compose up --build`. `UPLOADS_DIR` must point at
  the mount.
- **Uploads and rate limiting are per-container.** Image storage is local disk
  and the rate limiter is in-process, so running a second `app` replica would
  break both. Scaling out needs shared storage and a shared limiter first.

Retention deletes content across the network only insofar as each club's install
applies the removals it is sent; a club running a modified or long-stale install
keeps its copies. The Posts screen is the place to check what has actually
propagated.

---

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env — set a strong SESSION_SECRET (>= 32 chars) and SEED_ADMIN_PASSWORD
docker compose up --build
```

On startup the `app` container:

1. applies database migrations (`prisma migrate deploy`),
2. seeds a default admin if none exists (`prisma/seed.ts`, idempotent),
3. launches the standalone Next.js server.

Then open `https://localhost` (accept the local Caddy certificate) and sign in
with the seeded admin credentials.

## Quick start (local dev, no Docker)

```bash
npm install
# point DATABASE_URL in .env at a running Postgres, then:
npm run db:migrate    # or: npm run db:push
npm run seed
npm run dev           # http://localhost:3000
```

---

## Data model

| Model      | Purpose                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `User`     | Console operators. Roles: `ADMIN`, `MANAGER`, `USER`.                    |
| `Club`     | A linked lodge/club. Lifecycle: `PENDING → APPROVED / REJECTED`.         |
| `ApiToken` | API keys issued to an approved club. Only the SHA-256 hash is stored.   |
| `AuditLog` | Records client connections/requests and notable admin actions.          |
| `OtherLodge` | Central registry of external/partner lodges. Every row is handed out to every connected club; `sourceClub` records which club uploaded it. Also holds the lodge details below. |
| `Amenity`  | A free-form extra a lodge offers (name + optional description). Many to one `OtherLodge`, unique name per lodge, deleted with the lodge. |
| `SyncIssue` | An open or cleared condition for an administrator (starts with `VERSION_MISMATCH`). |
| `Image`    | A picture or logo in the image library. `kind` (`IMAGE` / `LOGO`) is fixed at upload; a lodge points at one of each (`OtherLodge.imageId`, `logoId`). |

### "Other lodges" distribution

This replicates the AlpineClubBookingsNZ "Other lodges" admin panel, but here it
is the **shared source of truth**. Admins manage the registry at `/lodges`
(`/api/admin/other-lodges` CRUD). Connected clubs upload their entries and
**every** entry is handed back out to every club connected via its API key —
there is no per-row "distribute" switch (it was removed before API version 2.0, the first release;
each club's nightly sync is what carries the registry out). See
**Distribution loop** under the REST API section below.

#### Lodge details and amenities (API version 2.0)

Besides name, location, booking officer and bed capacity, each lodge holds:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `siteUrl` | text (500) | Must start with `http://` or `https://`; anything else is rejected, because it is shown as a link. |
| `bookingPath` | text (300) | Free text. |
| `requiresLodgeCustodian`, `freeWifi`, `quietRoom`, `dryingRoom`, `sharedKitchen`, `wheelchairAccessible`, `breakfastIncluded`, `lunchIncluded`, `dinnerIncluded` | yes/no | Default **no**; "not known" and "no" are not distinguished. |
| `cancellationPeriod` | text (200) | Free text. |
| `winterSeasonStart`, `summerSeasonStart` | date | A calendar date with a year, `YYYY-MM-DD`; never shifted by time zone. |
| `amenities` | list | `{ name, description? }`, at most 50 per lodge, names unique ignoring case. |

On the API, `amenities` **replaces the lodge's whole set** when present in an
upload and leaves it alone when absent; every other field left out of an upload
is left unchanged. Pull returns every field and the amenity list. Changing a
lodge's amenities moves the lodge's `updatedAt`, so the incremental pull sees it.
Admins edit all of it on `/lodges`.

#### Which lodges a club owns

A lodge has at most one owning club (`OtherLodge.sourceClubId`); no owner means
it is central. That owner decides whose upload may change the lodge, so there is
one source of truth. On `/clubs`, each **approved** club has a **Lodges** section:
the lodges it owns are listed side by side above a multi-select dropdown, and an
administrator or manager ticks or unticks lodges and saves. One booking site can
run several lodges, so a club can own several.

- A lodge owned by **another** club is listed greyed out with that club's name; it
  has to be unticked there first. The server refuses it too, so the choice can
  never silently take a lodge from another club.
- Unticking returns a lodge to central ownership; it does not delete it.
- Saving is all-or-nothing, including when two people save at once.
- A club can still add a **new** lodge by uploading it; it becomes that club's.
- Every pull of `GET /api/v1/other-lodges` returns `ownLodgeNames`, by lodge name
  (the booking site keys its copy by name), so the site can allow editing only
  those. It is sent on every pull, incremental or not, because it is the club's
  whole current list and not a delta. A club's upload can only change a lodge it
  owns; the server enforces that whatever the site does.

#### Image manager and lodge pictures

`/admin/image-manager` is the library of pictures stored on this server (under
`UPLOADS_DIR`, the same volume as post images). Administrators and managers can:

- **Upload** one or more pictures, choosing whether they are **lodge images** or
  **logos**. At most 10 files and 9 MB in total per upload (the proxy caps the
  body at 10 MB). Every file is checked by its leading bytes (not its declared
  type), decoded within a pixel ceiling, resized, stripped of its metadata
  (including GPS location) and stored as WebP; the original is never kept. Lodge
  images are stored at most 1920 by 1080; logos at most 600 by 600 and keep their
  transparency. A file that fails is reported and the rest of the batch still goes in.
- **Rename** a picture (a label only; its type cannot be changed).
- **Delete** a picture. Refused, naming the lodges, while a lodge is using it.

On `/lodges`, the add/edit popup has a **Lodge image** and a **Lodge logo**
chooser. Each offers only pictures of the matching type, and the server refuses
a mismatch or a picture that no longer exists. Choosing, changing or removing
them is part of saving the lodge.

Pictures are served at `/api/images/library/<id>.webp`, an unguessable
capability link like post images (a browser `<img>` cannot send credentials), so
a leaked link exposes that one picture only. **Lodge pictures are not yet sent to
connected clubs**: they are admin-only until the club-facing API is extended (an
API version change, with the booking site updated to match).

Schema: [`prisma/schema.prisma`](prisma/schema.prisma). Baseline migration:
[`prisma/migrations/0000_init`](prisma/migrations/0000_init).

---

## Security model

- **Console auth** — email + password (bcrypt, cost 12). Sessions are signed
  JWTs (HS256, `jose`) stored in an `httpOnly`, `SameSite=Lax` cookie. The
  Edge proxy ([`src/proxy.ts`](src/proxy.ts)) gates `/dashboard` and `/clubs`.
- **API auth** — clients present `Authorization: Bearer <token>` (or
  `X-API-Key`). Tokens are `acs_<prefix>_<secret>`; the server looks up the row
  by the non-secret prefix and verifies the secret against the stored SHA-256
  hash in constant time. Revoked tokens and non-approved clubs are rejected.
- **Rate limiting** — fixed-window limiter keyed by token (sync) or source IP
  (registration); see [`src/lib/rate-limit.ts`](src/lib/rate-limit.ts).
- **Edge headers** — Caddy sets HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` and caps request bodies.

Tokens are shown in plaintext **exactly once**, at generation time.

---

## Web console pages

| Path         | Access        | Purpose                                                        |
| ------------ | ------------- | -------------------------------------------------------------- |
| `/login`     | public        | Email + password sign-in.                                      |
| `/register`  | public        | Lodge submits a link request.                                  |
| `/dashboard` | session       | Connected-club stats and recent client activity.              |
| `/clubs`     | session       | Approve/reject applications, issue & revoke API keys, and **choose the lodges each approved club owns** (multi-select; admin/manager). |
| `/lodges`    | session       | Central **"Other lodges"** registry — add/edit/delete, and see which club last updated each entry. |
| `/admin/image-manager` | admin/manager | **Image manager** — upload pictures and logos, rename them, delete the ones no lodge uses. See below. |
| `/issues`    | admin/manager | **Issues** — conditions that need a person to look at them, starting with clubs whose API version differs from this server's. An issue stays until it is flagged as cleared. |
| `/audit`     | admin/manager | **Audit log** — all activity in and out of the server (client uploads/pulls, connections, admin actions), filterable + paginated. |
| `/profile`   | session       | Account info, **change password**, **light/dark theme**, sign out. |

The console header carries a quick light/dark toggle; `/profile` has the full
Light / Dark / System control (persisted via `next-themes`). Changing a password
verifies the current one, rehashes with bcrypt, records an audit entry, and
signs the user out to re-authenticate with the new credentials.

---

## REST API (clients)

| Method & path                | Auth        | Purpose                                   |
| ---------------------------- | ----------- | ----------------------------------------- |
| `POST /api/v1/clubs/register`| none (rate-limited) | Request linking. Creates a `PENDING` club. |
| `POST /api/v1/sync`          | Bearer token | Push/pull sync batch for an approved club. |
| `POST /api/v1/other-lodges`  | Bearer token (`lodges:write`) | Upload the club's "Other lodges" entries. |
| `GET  /api/v1/other-lodges`  | Bearer token (`lodges:read`)  | Pull every entry, plus `ownLodgeNames`: the lodges this club owns. **A booking officer's phone number is never sent** (see below). |
| `GET  /api/v1/version`       | Bearer token (any approved club) | The server's **API version**, and whether the caller's matches. See below. |
| `GET  /api/health`           | none        | Liveness + DB connectivity probe.          |

### API version

The server has one `major.minor` **API version** (`SERVER_API_VERSION` in
`src/lib/api-version.ts`, currently `2.0`) covering the whole `/api/v1` contract
— other lodges, the message board, push registration and anything added later.
A club holds the version it was built for and syncs only while the two are
**identical**; any difference, a minor-only one included, pauses all transfer in
both directions until the club is upgraded.

- **Check:** `GET /api/v1/version` with the club's Bearer token and its own
  version in `X-Client-Api-Version` (or `?clientVersion=`). It always answers
  `200 { "version": "1.0", "match": true | false | null }` — `match` is `null`
  when the caller declared no version. A club with no API key makes no call.
- **Every check is audited** on `/audit` as `api.version.check`, with both
  versions and `match`. A mismatch also writes `api.version.mismatch` with
  outcome `FAILURE`.
- **Issues screen:** a mismatch opens (or refreshes) one `VERSION_MISMATCH`
  issue per club on `/issues`, showing the club, the lodges it has uploaded,
  both versions, first/last seen and a count. It stays until an admin or manager
  flags it **cleared**, even if the club has since caught up (the row then says
  "ready to clear"). A cleared club that mismatches again opens a fresh issue.
- **Enforcement:** every other data route (`sync`, `other-lodges`, `feed`,
  `feed/sync`, `posts`, `posts/:id`, `posts/:id/report`, `push-target`) returns
  `409 { "code": "API_VERSION_MISMATCH", "serverVersion", "clientVersion" }`
  to a request that declares a different version, before any data is read or
  written. A malformed declared version is `400`. A request that declares **no**
  version is not refused — software older than this check cannot send one — so
  such a club appears here only once it is upgraded and checking. Shared-post
  pushes to a club whose last reported version differs are **held** (not failed,
  no attempt consumed) until it matches.
- **Comparing versions:** by integer parts, never as a number — `1.10` is not
  `1.1`. Canonical form only (`1.0`, not `01.0` or `1.00`).
- **History:** `2.0` is the first RELEASED contract. It includes everything built
  in the pre-release versions: `1.0` (the version check itself), `1.1` (lodge
  detail fields and amenities, and every lodge distributed) and `1.2` (the pull
  also returns `ownLodgeNames` and never sends a booking officer's phone
  number). No club ever held `1.x`; their fingerprints stay in
  `api-contract-fingerprints.json` as a record, and `2.0` carries the same
  fingerprint as `1.2` because the contract itself did not change when the
  number was raised to mark the release.
- **Bumping:** raise the major for an incompatible `/api/v1` request or response
  change, the minor for a bug fix clubs should be upgraded for. Remember that
  **any** bump pauses every club until each is upgraded. The contract test
  (`src/lib/__tests__/api-contract.test.ts`) fingerprints the v1 surface and
  fails when it changes without a new entry for the new version in
  `src/lib/api-contract-fingerprints.json`; never overwrite an existing entry.

### Booking officer phone numbers are not distributed

A lodge's booking officer name and email are sent to every connected club, but
the booking officer's **phone number is not**: it is a private person's number,
given to one club, and sending it in every pull stored it, unseen, in every
other club's database. The server still holds it, central administrators can
edit it on the Lodges screen, and a club can still upload its own lodge's
number; it is just never in a pull response (`bookingOfficerPhone` is absent
from the club-facing shape, and the contract test fails if it is added back
without a version change).

### Distribution loop

1. A connected club **uploads** its entries: `POST /api/v1/other-lodges` with
   `{ "lodges": [ { "name": "...", "location": "...", "bedCapacity": 20 } ] }`.
   Each entry is keyed by unique `name` and **owned** by the uploading club —
   new names are created, the club's own entries are updated, and names owned
   centrally or by another club are **skipped** (no clobber).
2. A **central admin** can add and edit entries at `/lodges`; nothing needs to
   be ticked for an entry to be shared.
3. Every connected club **pulls** the registry: `GET /api/v1/other-lodges`
   returns every entry. Pass `?since=<ISO>` for an incremental pull; use the
   response `cursor` as the next `since`.

Admin-only:

| Method & path                       | Auth    | Purpose                        |
| ----------------------------------- | ------- | ------------------------------ |
| `POST /api/admin/clubs/:id/tokens`  | session | Issue an API key to a club.    |

### Example: register a lodge

```bash
curl -X POST https://localhost/api/v1/clubs/register \
  -H "content-type: application/json" \
  -d '{"name":"Ruapehu Lodge","code":"RUAPEHU","contactEmail":"contact@ruapehu.nz"}'
```

### Example: sync (after approval + token issued)

```bash
curl -X POST https://localhost/api/v1/sync \
  -H "authorization: Bearer acs_xxxxxxxx_yyyy...." \
  -H "content-type: application/json" \
  -d '{"records":[]}'
```

---

## Scripts

| Command                | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Dev server (Turbopack).                        |
| `npm run build`        | `prisma generate` + production build.          |
| `npm start`           | Serve the production build.                     |
| `npm test`             | Vitest suite.                                  |
| `npm run typecheck`    | `tsc --noEmit`.                                |
| `npm run seed`         | Idempotent default-admin seed.                 |
| `npm run db:migrate`   | Apply migrations (`prisma migrate deploy`).    |
| `npm run db:migrate:dev` | Create/apply a dev migration.                |

---

## Tests

Vitest covers the security-critical units and the registration endpoint:

- API token generation / parsing / constant-time verification;
- session JWT sign/verify (tamper, wrong-secret, expiry);
- password hashing;
- API request authentication flow (missing / malformed / unknown / revoked /
  unapproved / valid);
- club registration idempotency;
- `POST /api/v1/clubs/register` (201 / 400 / 200-existing / 429 rate limit);
- lodge ownership: assigning lodges to a club (all-or-nothing, refusing another
  club's lodge, the race), the admin route, and the owned list on the pull;
- the image library: upload processing (profiles, transparency, size limits, EXIF
  strip), the admin API, serving, lodge picture/logo validation, and the proxy
  coverage guard;
- the API version check: version parsing and comparison, `GET /api/v1/version`,
  the 409 gate on data routes (and a census that every v1 handler runs it), the
  contract fingerprint, the push hold for a mismatched club, and clearing issues.

```bash
npm test
```
