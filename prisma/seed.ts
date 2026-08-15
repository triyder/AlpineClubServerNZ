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

async function main() {
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
