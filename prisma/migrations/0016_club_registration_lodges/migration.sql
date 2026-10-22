-- A registering club says which lodge(s) it is and may leave a note for the
-- administrator (#40). The lodges are REQUESTED, not owned: ownership is still
-- `other_lodges.source_club_id`, assigned on approval. Two additive columns,
-- no data rewritten; every existing club reads as having requested nothing.

ALTER TABLE "clubs" ADD COLUMN "requested_lodge_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "registration_notes" VARCHAR(500);
