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
    .max(128, "New password must be at most 128 characters"),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Admin-issued token creation. */
export const createTokenSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(60)).max(50).default(["sync:read", "sync:write"]),
});
export type CreateTokenInput = z.infer<typeof createTokenSchema>;
