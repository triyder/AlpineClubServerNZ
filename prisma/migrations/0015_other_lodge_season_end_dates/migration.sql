-- Each season gets an END date (owner, 16 Oct 2026): the last day of the
-- season. Seasons recur, so only month and day are used. Unset, a season runs
-- up to the other season's start, as before. Two nullable columns, no data.

ALTER TABLE "other_lodges" ADD COLUMN "winter_season_end" DATE,
ADD COLUMN "summer_season_end" DATE;
