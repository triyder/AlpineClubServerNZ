import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openSecret, sealSecret, secretBoxAvailable, SecretBoxError } from "@/lib/secret-box";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";

describe("secret-box (#33)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.SETTINGS_ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = saved;
  });

  it("round-trips a secret, stores it unreadably, and never seals the same way twice", () => {
    const a = sealSecret("hunter2");
    const b = sealSecret("hunter2");
    expect(a).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(a).not.toContain("hunter2");
    expect(a).not.toBe(b);
    expect(openSecret(a)).toBe("hunter2");
    expect(openSecret(b)).toBe("hunter2");
  });

  it("refuses a tampered value and a value sealed under another key, in plain words", () => {
    const sealed = sealSecret("hunter2");
    const [v, iv, tag, data] = sealed.split(":");
    const flipped = data.slice(0, -1) + (data.endsWith("0") ? "1" : "0");
    expect(() => openSecret([v, iv, tag, flipped].join(":"))).toThrow(SecretBoxError);
    process.env.SETTINGS_ENCRYPTION_KEY = KEY.split("").reverse().join("");
    expect(() => openSecret(sealed)).toThrow(/SETTINGS_ENCRYPTION_KEY has changed/);
    expect(() => openSecret("v0:aa:bb:cc")).toThrow(SecretBoxError);
  });

  it("is unavailable without a key of at least 32 characters, and says so rather than storing in the clear", () => {
    process.env.SETTINGS_ENCRYPTION_KEY = "short";
    expect(secretBoxAvailable()).toBe(false);
    expect(() => sealSecret("hunter2")).toThrow(/SETTINGS_ENCRYPTION_KEY is not set/);
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(secretBoxAvailable()).toBe(false);
  });
});
