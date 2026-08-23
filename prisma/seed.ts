/**
 * Idempotent seed: create a default Admin account if no admin exists yet.
 * Safe to run on every container start (see docker-compose `app.command`).
 *
 *   npm run seed
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Self-contained on purpose: the production runtime image copies `prisma/` and
// `node_modules` but NOT `src/`, so this script must not import from `@/lib`.
// Keep the cost factor in step with src/lib/auth/password.ts (12).
const BCRYPT_ROUNDS = 12;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

// Communication Portal defaults. Kept in step with POST_SETTINGS_DEFAULTS in
// src/lib/settings.ts — this script cannot import from `@/lib` (see note above),
// so the two are duplicated deliberately and a test asserts they agree.
const POST_SETTINGS = [
  { key: "posts.retention_days", value: "365" },
  { key: "posts.auto_hide_threshold", value: "3" },
  { key: "posts.auto_hide_min_clubs", value: "1" },
  { key: "posts.tombstone_horizon_days", value: "90" },
];

// Scheduled jobs whose single-flight claim row must exist. The guarded
// `updateMany` that takes the claim matches nothing when the row is absent, so
// a missing row reads as "permanently held" and the job would never run.
const JOB_CLAIMS = ["posts.cleanup"];

async function seedPortalDefaults() {
  // `create`-only: never overwrite a value an operator has changed in the
  // console. This runs on every container start.
  for (const setting of POST_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: setting,
      update: {},
    });
  }

  for (const name of JOB_CLAIMS) {
    await prisma.jobClaim.upsert({
      where: { name },
      create: { name, startedAt: null },
      update: {},
    });
  }

  console.log(
    `[seed] Communication Portal defaults ensured (${POST_SETTINGS.length} settings, ${JOB_CLAIMS.length} job claim).`,
  );
}

async function main() {
  await seedPortalDefaults();

  const existingAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (existingAdmin) {
    console.log(`[seed] Admin already exists (${existingAdmin.email}); nothing to do.`);
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@alpineclub.nz";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const admin = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      role: "ADMIN",
    },
  });

  console.log(`[seed] Created default admin: ${admin.email}`);
  if (password === "ChangeMe123!") {
    console.warn(
      "[seed] WARNING: default admin password is in use. Set SEED_ADMIN_PASSWORD and rotate it after first login.",
    );
  }
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
