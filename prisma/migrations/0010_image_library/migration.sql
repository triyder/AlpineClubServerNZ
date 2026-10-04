-- Image library and lodge picture/logo links (issue #5).
--
-- Additive: one enum, one table, and two nullable columns on "other_lodges".

-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('IMAGE', 'LOGO');

-- AlterTable
ALTER TABLE "other_lodges" ADD COLUMN     "image_id" TEXT,
ADD COLUMN     "logo_id" TEXT;

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "kind" "ImageKind" NOT NULL DEFAULT 'IMAGE',
    "name" VARCHAR(200) NOT NULL,
    "public_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "images_public_id_key" ON "images"("public_id");

-- CreateIndex
CREATE INDEX "images_kind_created_at_idx" ON "images"("kind", "created_at");

-- CreateIndex
CREATE INDEX "other_lodges_image_id_idx" ON "other_lodges"("image_id");

-- CreateIndex
CREATE INDEX "other_lodges_logo_id_idx" ON "other_lodges"("logo_id");

-- AddForeignKey
ALTER TABLE "other_lodges" ADD CONSTRAINT "other_lodges_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_lodges" ADD CONSTRAINT "other_lodges_logo_id_fkey" FOREIGN KEY ("logo_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

