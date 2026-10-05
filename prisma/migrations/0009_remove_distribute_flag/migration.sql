-- Every lodge is now distributed; the per-row "distribute" marker is removed (issue #4).
--
-- The marker used to gate GET /api/v1/other-lodges, and the incremental pull is
-- keyed on "updated_at". A club that has already pulled holds a cursor past every
-- lodge that was never marked, so those lodges would never reach it. Moving the
-- "updated_at" of exactly those rows to now re-announces them on the next pull.
-- Only those rows: a lodge that was already distributed is already held by every
-- club, and bumping it too would re-send the whole registry and, through a club's
-- admin Download, could overwrite a local edit that had not yet been uploaded.
--
-- This statement was changed after the migration had been pushed but before it
-- was deployed anywhere except one developer's database, which is why it was
-- edited in place rather than followed by a corrective migration.

UPDATE "other_lodges" SET "updated_at" = CURRENT_TIMESTAMP WHERE "distribute" = false;

-- DropIndex
DROP INDEX "other_lodges_distribute_idx";

-- AlterTable
ALTER TABLE "other_lodges" DROP COLUMN "distribute";

