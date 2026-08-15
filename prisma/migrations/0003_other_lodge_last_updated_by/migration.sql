-- AlterTable
ALTER TABLE "other_lodges" ADD COLUMN     "last_updated_by_club_id" TEXT,
ADD COLUMN     "last_uploaded_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "other_lodges" ADD CONSTRAINT "other_lodges_last_updated_by_club_id_fkey" FOREIGN KEY ("last_updated_by_club_id") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

