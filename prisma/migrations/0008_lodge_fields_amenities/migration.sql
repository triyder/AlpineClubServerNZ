-- Lodge fields and amenities (issue #4).
--
-- Additive: fourteen columns on "other_lodges" (booleans with constant defaults,
-- so PostgreSQL rewrites no heap; the rest nullable) and one new table.

-- AlterTable
ALTER TABLE "other_lodges" ADD COLUMN     "booking_path" VARCHAR(300),
ADD COLUMN     "breakfast_included" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancellation_period" VARCHAR(200),
ADD COLUMN     "dinner_included" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "drying_room" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "free_wifi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lunch_included" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quiet_room" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requires_lodge_custodian" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shared_kitchen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "site_url" VARCHAR(500),
ADD COLUMN     "summer_season_start" DATE,
ADD COLUMN     "wheelchair_accessible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "winter_season_start" DATE;

-- CreateTable
CREATE TABLE "amenities" (
    "id" TEXT NOT NULL,
    "lodge_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "amenities_lodge_id_name_key" ON "amenities"("lodge_id", "name");

-- AddForeignKey
ALTER TABLE "amenities" ADD CONSTRAINT "amenities_lodge_id_fkey" FOREIGN KEY ("lodge_id") REFERENCES "other_lodges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

