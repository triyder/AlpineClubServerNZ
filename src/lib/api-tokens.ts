import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API token format:  acs_<prefix8>_<secret40>
 *
 * - `acs_`      brand marker so a leaked token is greppable and identifiable.
 * - `<prefix8>` a short, NON-secret lookup id, stored in the clear as
 *               `tokenPrefix` so validation can find the row by an indexed
 *               column instead of scanning every hash.
 * - `<secret>`  the high-entropy secret. Only its SHA-256 hash is persisted.
 *
 * Tokens are opaque bearer credentials for machine-to-machine calls, so a fast
 * SHA-256 (not bcrypt) is appropriate: they carry full entropy already and are
 * verified on every request. User passwords still use bcrypt (see auth/).
 */

const TOKEN_BRAND = "acs";
const PREFIX_BYTES = 4; // -> 8 hex chars
const SECRET_BYTES = 20; // -> 40 hex chars

export interface GeneratedToken {
  /** Full plaintext token — shown to the club exactly once, never stored. */
  plaintext: string;
  /** Non-secret lookup prefix, e.g. "acs_ab12cd34". Stored in the clear. */
  prefix: string;
  /** SHA-256 hash of the full plaintext. Stored in `tokenHash`. */
  hash: string;
}

/** Create a fresh random API token together with its lookup prefix and hash. */
export function generateApiToken(): GeneratedToken {
  const prefixHex = randomBytes(PREFIX_BYTES).toString("hex");
  const secretHex = randomBytes(SECRET_BYTES).toString("hex");
  const prefix = `${TOKEN_BRAND}_${prefixHex}`;
  const plaintext = `${prefix}_${secretHex}`;
  return { plaintext, prefix, hash: hashToken(plaintext) };
}

/** SHA-256 hex hash of a token's plaintext. */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Parse the non-secret lookup prefix out of a presented token. Returns null
 * for anything not shaped like `acs_<prefix>_<secret>`.
 */
export function parseTokenPrefix(plaintext: string): string | null {
  const parts = plaintext.split("_");
  if (parts.length !== 3) return null;
  const [brand, prefixHex, secretHex] = parts;
  if (brand !== TOKEN_BRAND) return null;
  if (!/^[0-9a-f]+$/.test(prefixHex) || !/^[0-9a-f]+$/.test(secretHex)) {
    return null;
  }
  return `${brand}_${prefixHex}`;
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatchesHash(plaintext: string, storedHash: string): boolean {
  const presented = Buffer.from(hashToken(plaintext), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}
