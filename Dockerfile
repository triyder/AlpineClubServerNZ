# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# AlpineClubServerNZ production image (multi-stage).
#   deps    -> install node_modules from lockfile
#   builder -> prisma generate + next build (standalone output)
#   runner  -> minimal runtime; runs migrations, seed, then `node server.js`
# ---------------------------------------------------------------------------
FROM node:24.17-alpine AS base

# ----- dependencies --------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
# Fall back to `npm install` when no lockfile is present (fresh scaffold).
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ----- build ---------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# A placeholder URL so `prisma generate` / `next build` succeed without a live
# DB. The real DATABASE_URL is injected at runtime by docker-compose.
ENV DATABASE_URL=postgresql://user:pass@db:5432/app?schema=public

RUN npx prisma generate
RUN npm run build

# ----- runtime -------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Pacific/Auckland
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Standalone server + static assets.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma schema/migrations, the seed script and the full node_modules are kept
# in the runtime image so the container can run `prisma migrate deploy` and
# `tsx prisma/seed.ts` on startup (see docker-compose `app.command`).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
