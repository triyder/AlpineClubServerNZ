-- Communication Portal: push delivery of shared posts to club installs.
--
-- Additive throughout: two enums, one table, and three nullable-or-defaulted
-- columns on "clubs". Nothing is dropped, renamed or retyped, and no existing
-- row is rewritten.

CREATE TYPE "PostDeliveryKind" AS ENUM ('CREATED', 'REMOVED');
CREATE TYPE "PostDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'ABANDONED');

-- Where a club wants posts pushed, and which generation of its signing secret
-- is current. The SECRET ITSELF IS DELIBERATELY ABSENT: it is derived from the
-- server's signing key plus (club id, version), so a database dump does not
-- hand over the ability to forge pushes to every club on the network.
-- Both defaults are constants, so PostgreSQL records them in the catalog and
-- rewrites no heap.
ALTER TABLE "clubs" ADD COLUMN "push_url" VARCHAR(2000);
ALTER TABLE "clubs" ADD COLUMN "push_secret_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "clubs" ADD COLUMN "push_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "post_deliveries" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "club_id" TEXT NOT NULL,
    "kind" "PostDeliveryKind" NOT NULL DEFAULT 'CREATED',
    "status" "PostDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "last_error" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_deliveries_pkey" PRIMARY KEY ("id")
);

-- One delivery per post per club per kind. THIS IS THE IDEMPOTENCE: enqueueing
-- twice cannot queue a second copy, so a re-share or a repeated withdrawal
-- cannot make a club receive the same post twice.
CREATE UNIQUE INDEX "post_deliveries_post_id_club_id_kind_key"
  ON "post_deliveries"("post_id", "club_id", "kind");

-- The worker's only query: eligible work, oldest first.
CREATE INDEX "post_deliveries_status_next_attempt_at_idx"
  ON "post_deliveries"("status", "next_attempt_at");

-- Both cascade: a post that is gone has nothing to deliver, and a club that is
-- gone has nowhere to deliver to. Built over an empty table, so the validating
-- scan is trivial regardless of how many posts or clubs exist.
ALTER TABLE "post_deliveries" ADD CONSTRAINT "post_deliveries_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_deliveries" ADD CONSTRAINT "post_deliveries_club_id_fkey"
  FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
