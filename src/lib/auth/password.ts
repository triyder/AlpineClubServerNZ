import bcrypt from "bcryptjs";

// Cost factor 12 is a reasonable balance of security and latency for
// interactive login on modern hardware.
const BCRYPT_ROUNDS = 12;

/** Hash a plaintext password for storage. */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/** Constant-time verification of a plaintext password against a stored hash. */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
