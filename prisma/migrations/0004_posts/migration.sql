-- CreateEnum
CREATE TYPE "PostHiddenBy" AS ENUM ('SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "PostRemovedBy" AS ENUM ('CLUB', 'ADMIN', 'RETENTION');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'INAPPROPRIATE', 'HARASSMENT', 'OTHER');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "last_comms_sync_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "author_email" VARCHAR(320),
    "author_name" VARCHAR(200) NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "hidden_at" TIMESTAMP(3),
    "hidden_by" "PostHiddenBy",
    "auto_hide_exempt" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMP(3),
    "removed_by" "PostRemovedBy",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_images" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_reports" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "reporter_club_id" TEXT NOT NULL,
    "reporter_user_id" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(1000),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "job_claims" (
    "name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),

    CONSTRAINT "job_claims_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "posts_created_at_id_idx" ON "posts"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "posts_updated_at_id_idx" ON "posts"("updated_at", "id");

-- CreateIndex
CREATE INDEX "posts_club_id_idx" ON "posts"("club_id");

-- CreateIndex
CREATE INDEX "posts_report_count_idx" ON "posts"("report_count");

-- CreateIndex
CREATE INDEX "posts_hidden_at_idx" ON "posts"("hidden_at");

-- CreateIndex
CREATE INDEX "posts_removed_at_idx" ON "posts"("removed_at");

-- CreateIndex
CREATE UNIQUE INDEX "post_images_public_id_key" ON "post_images"("public_id");

-- CreateIndex
CREATE INDEX "post_images_post_id_idx" ON "post_images"("post_id");

-- CreateIndex
CREATE INDEX "post_reports_post_id_idx" ON "post_reports"("post_id");

-- CreateIndex
CREATE INDEX "post_reports_reporter_club_id_idx" ON "post_reports"("reporter_club_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_reports_post_id_reporter_club_id_reporter_user_id_key" ON "post_reports"("post_id", "reporter_club_id", "reporter_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reporter_club_id_fkey" FOREIGN KEY ("reporter_club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
