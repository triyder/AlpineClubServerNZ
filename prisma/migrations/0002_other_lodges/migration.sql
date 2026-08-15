-- CreateTable
CREATE TABLE "other_lodges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" VARCHAR(300),
    "booking_officer_name" VARCHAR(200),
    "booking_officer_email" VARCHAR(320),
    "booking_officer_phone" VARCHAR(50),
    "bed_capacity" INTEGER,
    "distribute" BOOLEAN NOT NULL DEFAULT false,
    "source_club_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "other_lodges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "other_lodges_name_key" ON "other_lodges"("name");

-- CreateIndex
CREATE INDEX "other_lodges_distribute_idx" ON "other_lodges"("distribute");

-- CreateIndex
CREATE INDEX "other_lodges_source_club_id_idx" ON "other_lodges"("source_club_id");

-- AddForeignKey
ALTER TABLE "other_lodges" ADD CONSTRAINT "other_lodges_source_club_id_fkey" FOREIGN KEY ("source_club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

