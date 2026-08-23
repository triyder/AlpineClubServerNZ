/**
 * Next.js startup hook — the only place a standalone server can start a
 * long-running scheduler.
 *
 * Registers the nightly Communication Portal retention pass. The job itself
 * takes a single-flight claim (see post-cleanup.ts), so a second instance or an
 * admin pressing "Run cleanup now" cannot double-run it.
 */
export async function register() {
  // `register` also runs in the Edge runtime, which has no timers, no
  // filesystem and no Prisma client. Without this guard the import below throws
  // on every Edge boot.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Off by default outside production so `next dev` does not schedule a job on
  // every hot reload. Set POSTS_CLEANUP_ENABLED=true to exercise it locally.
  const enabled =
    process.env.NODE_ENV === "production" ||
    process.env.POSTS_CLEANUP_ENABLED === "true";
  if (!enabled) return;

  const [{ default: cron }, { runPostCleanup }, { logger }] = await Promise.all([
    import("node-cron"),
    import("@/lib/post-cleanup"),
    import("@/lib/logger"),
  ]);

  // The timezone argument is NOT optional here. The Dockerfile sets
  // TZ=Pacific/Auckland, and node-cron uses the process timezone by default, so
  // "0 2 * * *" would fire at 02:00 NZT — around 14:00 UTC, roughly half a day
  // from where it belongs and in the middle of the day for NZ users.
  cron.schedule(
    "0 2 * * *",
    () => {
      void runPostCleanup({ trigger: "cron" }).catch((err) => {
        logger.error({ err }, "scheduled posts cleanup failed");
      });
    },
    { timezone: "UTC" },
  );

  logger.info("scheduled posts cleanup for 02:00 UTC daily");
}
