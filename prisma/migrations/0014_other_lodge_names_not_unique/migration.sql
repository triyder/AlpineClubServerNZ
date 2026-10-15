-- Two lodges may share a name (#69): the id is what makes them distinct. The
-- unique index on the name goes; a plain one serves the lookalike warning and
-- the upload's match of a club's own lodge by name.

-- DropIndex
DROP INDEX "other_lodges_name_key";

-- CreateIndex
CREATE INDEX "other_lodges_name_idx" ON "other_lodges"("name");
