-- AlterTable: track when a user last changed their password (nullable; existing
-- rows keep NULL = "never changed").
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);
