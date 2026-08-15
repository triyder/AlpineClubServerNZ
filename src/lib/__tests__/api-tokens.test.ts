import { describe, it, expect } from "vitest";
import {
  generateApiToken,
  hashToken,
  parseTokenPrefix,
  tokenMatchesHash,
} from "@/lib/api-tokens";

describe("api-tokens", () => {
  it("generates a token whose parts line up with its prefix and hash", () => {
    const t = generateApiToken();
    expect(t.plaintext.startsWith("acs_")).toBe(true);
    expect(t.plaintext.startsWith(`${t.prefix}_`)).toBe(true);
    expect(parseTokenPrefix(t.plaintext)).toBe(t.prefix);
    expect(hashToken(t.plaintext)).toBe(t.hash);
  });

  it("produces unique tokens across calls", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it("verifies a matching token against its stored hash", () => {
    const t = generateApiToken();
    expect(tokenMatchesHash(t.plaintext, t.hash)).toBe(true);
  });

  it("rejects a token that does not match the stored hash", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(tokenMatchesHash(a.plaintext, b.hash)).toBe(false);
    expect(tokenMatchesHash(`${a.plaintext}x`, a.hash)).toBe(false);
  });

  it("returns null when parsing a malformed prefix", () => {
    expect(parseTokenPrefix("not-a-token")).toBeNull();
    expect(parseTokenPrefix("wrong_ab12_cd34")).toBeNull(); // bad brand
    expect(parseTokenPrefix("acs_ab12")).toBeNull(); // missing secret segment
    expect(parseTokenPrefix("acs_XYZ_cd34")).toBeNull(); // non-hex prefix
  });
});
