-- Every lodge is now distributed; the per-row "distribute" marker is removed (issue #4).
--
-- The marker used to gate GET /api/v1/other-lodges, and the incremental pull is
-- keyed on "updated_at". A club that has already pulled holds a cursor past every
-- lodge that was never marked, so those lodges would never reach it. Moving every
-- row's "updated_at" to now re-announces the whole registry on the next pull;
-- clubs skip rows identical to their own copy, so nothing is rewritten needlessly.

UPDATE "other_lodges" SET "updated_at" = CURRENT_TIMESTAMP;

-- DropIndex
DROP INDEX "other_lodges_distribute_idx";

-- AlterTable
ALTER TABLE "other_lodges" DROP COLUMN "distribute";

