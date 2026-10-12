-- Non-member rates per person per night (NZD incl. GST), a winter and a summer
-- set for each guideline age group. Display only; null = not set.

-- AlterTable
ALTER TABLE "other_lodges" ADD COLUMN     "winter_rate_under5" DECIMAL(8,2),
ADD COLUMN     "winter_rate_5_to_11" DECIMAL(8,2),
ADD COLUMN     "winter_rate_12_to_17" DECIMAL(8,2),
ADD COLUMN     "winter_rate_adult" DECIMAL(8,2),
ADD COLUMN     "summer_rate_under5" DECIMAL(8,2),
ADD COLUMN     "summer_rate_5_to_11" DECIMAL(8,2),
ADD COLUMN     "summer_rate_12_to_17" DECIMAL(8,2),
ADD COLUMN     "summer_rate_adult" DECIMAL(8,2);
