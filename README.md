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
| `GET  /api/health`           | none        | Liveness + DB connectivity probe.          |

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
