import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Payload a lodge submits to request linking with the central server. */
export const clubRegisterSchema = z.object({
  name: z.string().min(2).max(200),
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "code may contain letters, digits, - and _ only"),
  location: z.string().max(200).optional(),
  contactEmail: z.string().email().max(320),
});
export type ClubRegisterInput = z.infer<typeof clubRegisterSchema>;

/**
 * The web form's registration (#40): the API contract's fields plus the
 * lodges the club says it is (optional) and a note for the administrator.
 * Kept apart from `clubRegisterSchema` on purpose: that one is part of the
 * /api/v1 contract fingerprint, and widening it would demand a version bump
 * that pauses every connected club's sync for a form-only addition.
 */
export const clubRegisterFormSchema = clubRegisterSchema.extend({
  lodgeIds: z.array(z.string().min(1).max(64)).max(20).default([]),
  notes: z.string().trim().max(500).optional(),
});
export type ClubRegisterFormInput = z.infer<typeof clubRegisterFormSchema>;

/** Payload a client booking engine sends to the sync endpoint. */
export const syncSchema = z.object({
  // Monotonic cursor the client last successfully processed, if any.
  since: z.string().datetime().optional(),
  // Opaque batch of records the client is pushing up.
  records: z.array(z.record(z.string(), z.unknown())).max(1000).default([]),
});
export type SyncInput = z.infer<typeof syncSchema>;

/** Authenticated password change. New password: 12–128 chars (matches the
 *  AlpineClubBookingsNZ default policy). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(12, "New password must be at least 12 characters")
    .max(128, "New password must be at most 128 characters")
    // bcrypt reads only the first 72 BYTES; anything past them would be
    // silently ignored, so a long passphrase would be weaker than it looks.
    .refine(
      (v) => new TextEncoder().encode(v).length <= 72,
      "New password must be at most 72 bytes (fewer characters if it uses accents or symbols)",
    ),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Admin-issued token creation.
 *
 * `posts:read` covers the feed and the mirroring cursor; `posts:write` covers
 * sharing, reporting and a club withdrawing its own post. Two scopes rather
 * than three, matching the existing lodges read/write pair — reporting is not a
 * meaningfully different capability from posting for a club that has both.
 *
 * Tokens issued before the Communication Portal shipped do not carry these, so
 * they must be re-issued or topped up before a club can use the feed.
 */
export const createTokenSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z
    .array(z.string().min(1).max(60))
    .max(50)
    .default([
      "sync:read",
      "sync:write",
      "lodges:read",
      "lodges:write",
      "posts:read",
      "posts:write",
    ]),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;
