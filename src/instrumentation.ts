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

  const [
    { default: cron },
    { runPostCleanup },
    { runPostDeliverySweep },
    { logger },
  ] = await Promise.all([
    import("node-cron"),
    import("@/lib/post-cleanup"),
    import("@/lib/push-delivery"),
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

  // Push delivery. EVERY MINUTE, unlike the nightly cleanup beside it, because
  // this is the latency path: a member ticks "share with all clubs" and expects
  // it to appear on other boards now, not tomorrow. The sweep is bounded per
  // pass and does nothing at all when the queue is empty, which is most minutes.
  //
  // Overlap is guarded by a plain in-process flag rather than a database claim.
  // That is enough HERE and would not be in the client: this server runs a
  // single instance, and the worst case if that ever stops being true is a
  // delivery attempted twice, which the receiving club treats as idempotent.
  let deliverySweepRunning = false;
  cron.schedule(
    "* * * * *",
    () => {
      if (deliverySweepRunning) return;
      deliverySweepRunning = true;
      void runPostDeliverySweep()
        .then((result) => {
          if (result.attempted > 0) {
            logger.info({ ...result }, "post delivery sweep");
          }
        })
        .catch((err) => {
          logger.error({ err }, "post delivery sweep failed");
        })
        .finally(() => {
          deliverySweepRunning = false;
        });
    },
    { timezone: "UTC" },
  );

  logger.info("scheduled post delivery sweep every minute");
}
