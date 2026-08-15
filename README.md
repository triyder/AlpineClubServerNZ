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
| `web`   | `caddy:2-alpine`     | Reverse proxy, automatic HTTPS, security headers        |

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
| `OtherLodge` | Central registry of external/partner lodges. `distribute` marks a row for hand-out to connected clubs; `sourceClub` records which club uploaded it. |

### "Other lodges" distribution (in progress)

This replicates the AlpineClubBookingsNZ "Other lodges" admin panel, but here it
is the **shared source of truth**. Admins manage the registry at `/lodges`
(`/api/admin/other-lodges` CRUD) and toggle `distribute` per row. The end goal:
connected clubs upload their entries, admins mark rows for distribution, and
marked rows are handed back out to every club connected via its API key. Both
the admin registry and the client upload/pull endpoints are implemented — see
**Distribution loop** under the REST API section below.

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
| `/clubs`     | session       | Approve/reject applications, issue & revoke API keys.          |
| `/lodges`    | session       | Central **"Other lodges"** registry — add/edit/delete + mark for distribution. |
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
| `GET  /api/v1/other-lodges`  | Bearer token (`lodges:read`)  | Pull all entries marked for distribution. |
| `GET  /api/health`           | none        | Liveness + DB connectivity probe.          |

### Distribution loop

1. A connected club **uploads** its entries: `POST /api/v1/other-lodges` with
   `{ "lodges": [ { "name": "...", "location": "...", "bedCapacity": 20 } ] }`.
   Each entry is keyed by unique `name` and **owned** by the uploading club —
   new names are created (`distribute = false`), the club's own entries are
   updated, and names owned centrally or by another club are **skipped** (no
   clobber). Uploads never set the distribution marker.
2. A **central admin** reviews `/lodges` and toggles `distribute` on the entries
   that should be shared.
3. Every connected club **pulls** the distributed set: `GET /api/v1/other-lodges`
   returns all `distribute = true` entries. Pass `?since=<ISO>` for an
   incremental pull; use the response `cursor` as the next `since`.

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
- `POST /api/v1/clubs/register` (201 / 400 / 200-existing / 429 rate limit).

```bash
npm test
```
