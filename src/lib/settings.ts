import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Operator-tunable settings for the Communication Portal, stored as strings in
 * `system_settings` and parsed here.
 *
 * Every read falls back to the default below, for two reasons. A fresh database
 * that has not been seeded must still serve requests rather than 500, and a row
 * someone edited by hand into nonsense must not take the feed down — a wrong
 * threshold is recoverable, an unavailable API is not.
 */

export const SETTING_KEYS = {
  retentionDays: "posts.retention_days",
  autoHideThreshold: "posts.auto_hide_threshold",
  autoHideMinClubs: "posts.auto_hide_min_clubs",
  tombstoneHorizonDays: "posts.tombstone_horizon_days",
} as const;

export interface PostSettings {
  /** Days a network post lives before it is expired. 0 disables pruning. */
  retentionDays: number;
  /** Open reports needed to auto-hide a post. */
  autoHideThreshold: number;
  /** Distinct reporting clubs also required. 1 = any single club suffices. */
  autoHideMinClubs: number;
  /**
   * Days a removed post's stub row survives so mirroring clubs can converge.
   * Must exceed the longest plausible club outage: a club whose cursor predates
   * the horizon has missed removals it cannot catch up on and must full-resync.
   */
  tombstoneHorizonDays: number;
}

export const POST_SETTINGS_DEFAULTS: PostSettings = {
  retentionDays: 365,
  autoHideThreshold: 3,
  autoHideMinClubs: 1,
  tombstoneHorizonDays: 90,
};

/**
 * Bounds on what an admin may set. `retentionDays` allows 0 (disabled) but the
 * others do not: a threshold of 0 would hide every post on its first report,
 * and a tombstone horizon of 0 would delete stubs before any club could sync.
 */
export const postSettingsSchema = z.object({
  retentionDays: z.number().int().min(0).max(3650),
  autoHideThreshold: z.number().int().min(1).max(1000),
  autoHideMinClubs: z.number().int().min(1).max(1000),
  tombstoneHorizonDays: z.number().int().min(1).max(3650),
});
export type PostSettingsInput = z.infer<typeof postSettingsSchema>;

/** Retention choices offered in the console, in days. 0 = never prune. */
export const RETENTION_CHOICES = [
  { days: 90, label: "3 months" },
  { days: 183, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
  { days: 1826, label: "5 years" },
  { days: 0, label: "Disabled" },
] as const;

// Parse one stored string into a positive integer, or fall back. Anything
// non-numeric, negative or fractional is treated as absent rather than as an
// error, so one bad row cannot break the whole settings read.
function readInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn({ raw }, "ignoring malformed system_settings value");
    return fallback;
  }
  return parsed;
}

/** Read every Communication Portal setting, defaulting anything missing. */
export async function loadPostSettings(): Promise<PostSettings> {
  let rows: { key: string; value: string }[] = [];
  try {
    rows = await prisma.systemSetting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
      select: { key: true, value: true },
    });
  } catch (err) {
    // A settings read must never be the reason a request fails.
    logger.error({ err }, "failed to read system_settings; using defaults");
    return { ...POST_SETTINGS_DEFAULTS };
  }

  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    retentionDays: readInt(
      byKey.get(SETTING_KEYS.retentionDays),
      POST_SETTINGS_DEFAULTS.retentionDays,
    ),
    autoHideThreshold: readInt(
      byKey.get(SETTING_KEYS.autoHideThreshold),
      POST_SETTINGS_DEFAULTS.autoHideThreshold,
    ),
    autoHideMinClubs: readInt(
      byKey.get(SETTING_KEYS.autoHideMinClubs),
      POST_SETTINGS_DEFAULTS.autoHideMinClubs,
    ),
    tombstoneHorizonDays: readInt(
      byKey.get(SETTING_KEYS.tombstoneHorizonDays),
      POST_SETTINGS_DEFAULTS.tombstoneHorizonDays,
    ),
  };
}

/** Write all four settings. Upserts so a missing row is created, not an error. */
export async function savePostSettings(input: PostSettingsInput): Promise<void> {
  const pairs: [string, number][] = [
    [SETTING_KEYS.retentionDays, input.retentionDays],
    [SETTING_KEYS.autoHideThreshold, input.autoHideThreshold],
    [SETTING_KEYS.autoHideMinClubs, input.autoHideMinClubs],
    [SETTING_KEYS.tombstoneHorizonDays, input.tombstoneHorizonDays],
  ];

  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      }),
    ),
  );
}
