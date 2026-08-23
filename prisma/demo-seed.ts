/**
 * Demo data for the Communication Portal, so the admin screens have something
 * to look at without wiring up a real club install.
 *
 *   npm run seed:demo
 *
 * Creates three approved clubs with API tokens, a spread of shared posts with
 * real images on disk, and enough reports to populate every tab of /posts:
 * one post over the auto-hide threshold, one under it, and one already removed
 * so the mirroring cursor has a tombstone to hand out.
 *
 * IDEMPOTENT. Every row it writes is tagged, and a re-run deletes the previous
 * demo data first — so it can be run repeatedly while working on the screens
 * without piling up duplicates.
 *
 * REFUSES TO RUN IN PRODUCTION. It writes fabricated members' names and
 * fabricated reports; on a real deployment that is pollution of the moderation
 * record, not test data.
 *
 * Self-contained on purpose, like `seed.ts` beside it: the production runtime
 * image copies `prisma/` and `node_modules` but NOT `src/`, so this must not
 * import from `@/lib`. That is why the image write below is a small inline
 * sharp call rather than a call to `writeProcessedImage` — the seed only needs
 * a readable WebP at a path the image route can resolve.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

/** Every demo author id starts with this, which is how a re-run finds its own. */
const DEMO_AUTHOR_PREFIX = "demo-member-";
/** Club codes this script owns. Anything else is left alone. */
const DEMO_CLUB_CODES = ["DEMO_TARARUA", "DEMO_RUAPEHU", "DEMO_AORAKI"];

const uploadsRoot = path.resolve(process.env.UPLOADS_DIR ?? "./data/uploads");

/** Mirrors src/lib/api-tokens.ts. Duplicated because the seed cannot import it. */
function generateToken() {
  const prefix = `acs_${randomBytes(4).toString("hex")}`;
  const plaintext = `${prefix}_${randomBytes(20).toString("hex")}`;
  return {
    plaintext,
    prefix,
    hash: createHash("sha256").update(plaintext).digest("hex"),
  };
}

/** A plausible lodge photo, written where the image route will find it. */
async function writeDemoImage(
  seed: number,
): Promise<{ storageKey: string; publicId: string; width: number; height: number; bytes: number }> {
  const width = 1200;
  const height = 800;
  const webp = await sharp({
    create: {
      width,
      height,
      channels: 3,
      // Varied but deterministic, so a re-run produces the same pictures.
      background: {
        r: 40 + ((seed * 53) % 120),
        g: 80 + ((seed * 31) % 100),
        b: 70 + ((seed * 17) % 130),
      },
    },
  })
    .webp({ quality: 80 })
    .toBuffer();

  const now = new Date();
  const dir = path.posix.join(
    "posts",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  );
  const storageKey = path.posix.join(dir, `${randomBytes(16).toString("hex")}.webp`);
  const absolute = path.join(uploadsRoot, storageKey);

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, webp);

  return {
    storageKey,
    publicId: randomBytes(16).toString("hex"),
    width,
    height,
    bytes: webp.byteLength,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to write demo posts and fabricated reports to a production database.",
    );
  }

  // --- clean up the previous run -------------------------------------------
  // Posts cascade to their images and reports, so deleting the posts is enough
  // for the rows. The files they referenced are left where they are: the
  // retention job's orphan sweep is what collects those, and exercising it is
  // part of what this demo data is for.
  const removed = await prisma.post.deleteMany({
    where: { authorUserId: { startsWith: DEMO_AUTHOR_PREFIX } },
  });
  if (removed.count > 0) {
    console.log(`[demo] removed ${removed.count} post(s) from a previous run`);
  }

  // --- clubs and tokens ----------------------------------------------------
  const clubs: { id: string; code: string; name: string; token: string }[] = [];

  for (const [index, code] of DEMO_CLUB_CODES.entries()) {
    const name = code
      .replace("DEMO_", "")
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());

    const club = await prisma.club.upsert({
      where: { code },
      create: {
        code,
        name: `${name} Alpine Club (demo)`,
        contactEmail: `${code.toLowerCase()}@example.test`,
        status: "APPROVED",
      },
      update: { status: "APPROVED" },
    });

    // One live token per club, replacing any this script issued before so the
    // printed value below is always the one that works.
    await prisma.apiToken.deleteMany({
      where: { clubId: club.id, name: "demo-seed" },
    });
    const token = generateToken();
    await prisma.apiToken.create({
      data: {
        clubId: club.id,
        name: "demo-seed",
        tokenHash: token.hash,
        tokenPrefix: token.prefix,
        scopes: ["posts:read", "posts:write", "lodges:read", "lodges:write"],
      },
    });

    clubs.push({
      id: club.id,
      code,
      name: club.name,
      token: token.plaintext,
    });
    void index;
  }

  // --- posts ---------------------------------------------------------------
  const [tararua, ruapehu, aoraki] = clubs;

  async function share(options: {
    club: { id: string };
    author: string;
    name: string;
    content: string;
    ageDays: number;
    images?: number;
  }) {
    const images = [];
    for (let i = 0; i < (options.images ?? 0); i++) {
      images.push(await writeDemoImage(images.length + options.ageDays));
    }

    return prisma.post.create({
      data: {
        clubId: options.club.id,
        authorUserId: `${DEMO_AUTHOR_PREFIX}${options.author}`,
        authorName: options.name,
        authorEmail: `${options.author}@example.test`,
        content: options.content,
        createdAt: daysAgo(options.ageDays),
        updatedAt: daysAgo(options.ageDays),
        images: {
          create: images.map((image, position) => ({ ...image, position })),
        },
      },
      select: { id: true },
    });
  }

  const visible = await share({
    club: tararua,
    author: "jo",
    name: "Jo Whitcombe",
    content:
      "Hut book from the Whitcombe trip is back at the lodge — it had been in the bottom of somebody's pack since Easter. Also the second gas bottle is empty, so don't count on it.",
    ageDays: 2,
    images: 2,
  });

  await share({
    club: ruapehu,
    author: "alex",
    name: "Alex Rangi",
    content:
      "Chains were needed on the access road this morning above the second cattle stop. Grader had been through by midday but it is still slush at the top.",
    ageDays: 5,
    images: 1,
  });

  await share({
    club: aoraki,
    author: "sam",
    name: "Sam Iotua",
    content:
      "Anyone driving up Friday afternoon with a spare seat? Happy to share petrol and do the cooking.",
    ageDays: 9,
  });

  // An old one, so a retention window of 3 months has something to catch.
  await share({
    club: tararua,
    author: "pat",
    name: "Pat Nolan",
    content:
      "Reminder that the working bee is the first weekend of next month. Bring a drill if you have one.",
    ageDays: 200,
  });

  // --- reports -------------------------------------------------------------
  // Under the threshold: shows on Flagged, still visible to members.
  const flagged = await share({
    club: ruapehu,
    author: "chris",
    name: "Chris Devine",
    content:
      "Selling my old boots, size 44, barely used. Message me if interested and I can bring them up next trip.",
    ageDays: 3,
  });

  await prisma.postReport.createMany({
    data: [
      {
        postId: flagged.id,
        reporterClubId: tararua.id,
        reporterUserId: `${DEMO_AUTHOR_PREFIX}reporter-1`,
        reason: "SPAM",
        details: "Reads like an advert rather than club news.",
      },
      {
        postId: flagged.id,
        reporterClubId: aoraki.id,
        reporterUserId: `${DEMO_AUTHOR_PREFIX}reporter-2`,
        reason: "SPAM",
        details: null,
      },
    ],
  });
  await prisma.post.update({
    where: { id: flagged.id },
    data: { reportCount: 2 },
  });

  // Over the threshold: auto-hidden by SYSTEM, which is the queue's main case.
  const hidden = await share({
    club: aoraki,
    author: "dana",
    name: "Dana Sole",
    content:
      "Long rant about another club's booking officer that three people have now reported.",
    ageDays: 1,
  });

  await prisma.postReport.createMany({
    data: [
      {
        postId: hidden.id,
        reporterClubId: tararua.id,
        reporterUserId: `${DEMO_AUTHOR_PREFIX}reporter-3`,
        reason: "HARASSMENT",
        details: "Names an individual and is not about the lodges.",
      },
      {
        postId: hidden.id,
        reporterClubId: ruapehu.id,
        reporterUserId: `${DEMO_AUTHOR_PREFIX}reporter-4`,
        reason: "INAPPROPRIATE",
        details: null,
      },
      {
        postId: hidden.id,
        reporterClubId: aoraki.id,
        reporterUserId: `${DEMO_AUTHOR_PREFIX}reporter-5`,
        reason: "HARASSMENT",
        details: "Second this — it should come down.",
      },
    ],
  });
  await prisma.post.update({
    where: { id: hidden.id },
    data: { reportCount: 3, hiddenAt: daysAgo(0), hiddenBy: "SYSTEM" },
  });

  // Already removed, so /api/v1/feed/sync has a tombstone to hand out and the
  // convergence line on the Hidden tab has something to count against.
  const removedPost = await share({
    club: ruapehu,
    author: "kim",
    name: "Kim Ashford",
    content: "",
    ageDays: 20,
  });
  await prisma.post.update({
    where: { id: removedPost.id },
    data: { removedAt: daysAgo(1), removedBy: "ADMIN", authorEmail: null },
  });

  // --- summary -------------------------------------------------------------
  const counts = await prisma.post.groupBy({
    by: ["clubId"],
    _count: true,
    where: { authorUserId: { startsWith: DEMO_AUTHOR_PREFIX } },
  });

  console.log("\n[demo] Communication Portal demo data ready.\n");
  console.log(`  posts written : ${counts.reduce((sum, row) => sum + row._count, 0)}`);
  console.log(`  images written: under ${uploadsRoot}`);
  console.log("\n  Sign in to the console and open Posts:");
  console.log("    Hidden   — one auto-hidden post with three reports");
  console.log("    Flagged  — one post with two reports, still visible");
  console.log("    All      — everything except the removed one\n");
  console.log("  API tokens, if you want to exercise the client endpoints:\n");
  for (const club of clubs) {
    console.log(`    ${club.code.padEnd(14)} ${club.token}`);
  }
  console.log(
    "\n  e.g. curl -H \"Authorization: Bearer <token>\" http://localhost:3000/api/v1/feed\n",
  );
  console.log(
    "  These are demo credentials for a local database. Re-running this script replaces them.\n",
  );
}

main()
  .catch((err) => {
    console.error("[demo] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
