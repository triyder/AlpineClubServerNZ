-- Tombstones for deleted Other lodges (#16): the pull tells every club which
-- lodges were deleted since its cursor, so each can remove its own copy.

-- CreateTable
CREATE TABLE "deleted_other_lodges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_other_lodges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deleted_other_lodges_deleted_at_idx" ON "deleted_other_lodges"("deleted_at");
