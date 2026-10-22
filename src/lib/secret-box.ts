import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { settingsEncryptionKey } from "@/lib/env";

/**
 * Encryption at rest for the few secrets an administrator types into Settings
 * (#33: the SMTP password). AES-256-GCM under a key derived from
 * `SETTINGS_ENCRYPTION_KEY`, so a database dump does not hand the secret over
 * and a tampered ciphertext fails to decrypt rather than decrypting to junk.
 *
 * Stored shape: `v1:<iv hex>:<auth tag hex>:<ciphertext hex>`. The version
 * prefix is what a later key rotation or algorithm change keys on.
 */
const VERSION = "v1";

export class SecretBoxError extends Error {}

function keyBytes(): Buffer {
  const key = settingsEncryptionKey();
  if (!key) {
    throw new SecretBoxError(
      "SETTINGS_ENCRYPTION_KEY is not set (at least 32 characters), so a secret cannot be stored.",
    );
  }
  return createHash("sha256").update(key).digest();
}

/** Whether a secret can be stored and read: the key is present and long enough. */
export function secretBoxAvailable(): boolean {
  return settingsEncryptionKey() !== null;
}

export function sealSecret(plaintext: string): string {
  const key = keyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function openSecret(sealed: string): string {
  const [version, ivHex, tagHex, dataHex] = sealed.split(":");
  if (version !== VERSION || !ivHex || !tagHex || dataHex === undefined) {
    throw new SecretBoxError("The stored secret is not in a shape this server can read.");
  }
  const key = keyBytes();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretBoxError(
      "The stored secret could not be decrypted: SETTINGS_ENCRYPTION_KEY has changed since it was saved, or the value was altered. Enter it again.",
    );
  }
}
