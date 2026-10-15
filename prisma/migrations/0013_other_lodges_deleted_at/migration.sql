-- Logical deletion of Other lodges (#16): the admin Delete sets deleted_at and
-- the row stays (clubs' bookings may cite it). The pull reports deletions in
-- `deletedLodges`, so each club hides its own copy.

-- AlterTable
ALTER TABLE "other_lodges" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "other_lodges_deleted_at_idx" ON "other_lodges"("deleted_at");
