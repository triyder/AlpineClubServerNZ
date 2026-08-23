import "server-only";
import type { PostRemovedBy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deleteStoredImage } from "@/lib/uploads";
import { logger } from "@/lib/logger";

/**
 * Removing a post, shared by every caller that can do it: the authoring club
 * un-sharing, a central admin taking something down, and the retention job
 * expiring old content. All three do exactly the same thing to the row and
 * differ only in `removedBy`.
 *
 * What "removed" means here: the content is blanked and every image file is
 * unlinked AT ONCE, so the material is gone immediately. What survives is a
 * stub row carrying only ids and timestamps — and that stub IS the tombstone
 * that tells mirroring clubs to drop their copy. The retention job deletes it
 * once posts.tombstone_horizon_days has passed.
 *
 * Deleting the row outright instead would be worse than useless: mirrors poll a
 * cursor, so a row that simply vanishes is indistinguishable from one that
 * never changed, and every club would keep serving the post forever.
 */

export interface RemovalResult {
  /** False when the post was already removed — the call is idempotent. */
  removed: boolean;
  imagesDeleted: number;
  filesUnlinked: number;
}

const ALREADY_REMOVED: RemovalResult = {
  removed: false,
  imagesDeleted: 0,
  filesUnlinked: 0,
};

/**
 * Remove one post by id.
 *
 * `expectClubId` scopes the removal to a single club's own posts, which is what
 * the client API passes so a club can only ever withdraw its own content. Admin
 * callers omit it.
 *
 * Returns null when no post matches — either it never existed or, with
 * `expectClubId` set, it belongs to another club. Callers turn both into a 404
 * without distinguishing them, so a club cannot use this endpoint to discover
 * which post ids belong to other clubs.
 */
export async function removePost(
  postId: string,
  removedBy: PostRemovedBy,
  options: { expectClubId?: string } = {},
): Promise<RemovalResult | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      clubId: true,
      removedAt: true,
      images: { select: { id: true, storageKey: true } },
    },
  });

  if (!post) return null;
  if (options.expectClubId && post.clubId !== options.expectClubId) return null;
  if (post.removedAt) return ALREADY_REMOVED;

  const storageKeys = post.images.map((img) => img.storageKey);

  // Database first, filesystem second — deliberately.
  //
  // If the process dies between the two, this order leaves orphaned files with
  // no rows: wasted disk that nobody sees and the cleanup sweep reclaims. The
  // reverse order would leave rows pointing at files that no longer exist,
  // which renders as broken images on every club, visibly and permanently.
  // Prefer the failure mode nobody has to look at.
  const [, deletedImages] = await prisma.$transaction([
    prisma.post.update({
      where: { id: post.id },
      data: {
        content: "",
        authorEmail: null,
        removedAt: new Date(),
        removedBy,
      },
    }),
    prisma.postImage.deleteMany({ where: { postId: post.id } }),
  ]);

  let filesUnlinked = 0;
  for (const key of storageKeys) {
    try {
      if (await deleteStoredImage(key)) filesUnlinked++;
    } catch (err) {
      // The rows are already gone, so the post is removed as far as every club
      // is concerned. A file we failed to unlink is now an orphan, which the
      // cleanup sweep collects — worth recording, not worth failing the request
      // and telling an admin the takedown did not happen when it did.
      logger.error({ err, key }, "failed to unlink removed post image");
    }
  }

  return {
    removed: true,
    imagesDeleted: deletedImages.count,
    filesUnlinked,
  };
}
