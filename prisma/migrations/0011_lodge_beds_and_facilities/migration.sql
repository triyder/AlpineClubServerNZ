-- Lodge bed counts, walking time, room type, ski workshop and games room;
-- the free-text booking path is removed (the booking page URL is now one field).

-- CreateEnum
CREATE TYPE "lodge_room_type" AS ENUM ('ROOM', 'DORMITORY');

-- AlterTable
ALTER TABLE "other_lodges" DROP COLUMN "booking_path",
ADD COLUMN     "double_beds" INTEGER,
ADD COLUMN     "single_beds" INTEGER,
ADD COLUMN     "minutes_walk_to_lodge" INTEGER,
ADD COLUMN     "room_type" "lodge_room_type",
ADD COLUMN     "ski_workshop_area" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "games_room" BOOLEAN NOT NULL DEFAULT false;
