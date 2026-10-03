-- API version check and sync issues (issue #3).
--
-- Additive: two nullable columns on "clubs", one enum and one table. Nothing is
-- dropped, renamed or retyped, and no existing row is rewritten.

-- CreateEnum
CREATE TYPE "SyncIssueStatus" AS ENUM ('OPEN', 'CLEARED');

-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "last_reported_api_version" VARCHAR(16),
ADD COLUMN     "last_version_check_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sync_issues" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "club_id" TEXT NOT NULL,
    "client_version" VARCHAR(16),
    "server_version" VARCHAR(16) NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "status" "SyncIssueStatus" NOT NULL DEFAULT 'OPEN',
    "open_key" VARCHAR(80),
    "cleared_by_id" TEXT,
    "cleared_at" TIMESTAMP(3),
    "note" VARCHAR(500),

    CONSTRAINT "sync_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_issues_open_key_key" ON "sync_issues"("open_key");

-- CreateIndex
CREATE INDEX "sync_issues_status_idx" ON "sync_issues"("status");

-- CreateIndex
CREATE INDEX "sync_issues_club_id_idx" ON "sync_issues"("club_id");

-- AddForeignKey
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_cleared_by_id_fkey" FOREIGN KEY ("cleared_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

