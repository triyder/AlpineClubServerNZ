import { describe, it, expect } from "vitest";
import {
  CLIENT_API_VERSION_HEADER,
  SERVER_API_VERSION,
  apiVersionsMatch,
  parseApiVersion,
  readClientApiVersion,
} from "@/lib/api-version";

describe("parseApiVersion", () => {
  it("parses canonical major.minor into integer parts", () => {
    expect(parseApiVersion("1.0")).toEqual({ major: 1, minor: 0 });
    expect(parseApiVersion("12.34")).toEqual({ major: 12, minor: 34 });
    expect(parseApiVersion("1.10")).toEqual({ major: 1, minor: 10 });
  });

  it.each([
    "",
    "1",
    "1.",
    ".1",
    "1.0.0",
    "01.0",
    "1.00",
    "1.01",
    "+1.0",
    "-1.0",
    " 1.0",
    "1.0 ",
    "1,0",
    "v1.0",
    "1.1e0",
    "1000.0",
  ])("rejects %j", (raw) => {
    expect(parseApiVersion(raw)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseApiVersion(1.0)).toBeNull();
    expect(parseApiVersion(null)).toBeNull();
    expect(parseApiVersion(undefined)).toBeNull();
  });
});

describe("apiVersionsMatch", () => {
  it("matches identical versions", () => {
    expect(apiVersionsMatch("1.0", "1.0")).toBe(true);
    expect(apiVersionsMatch("2.15", "2.15")).toBe(true);
  });

  it("treats 1.10 and 1.1 as DIFFERENT versions (never compared as floats)", () => {
    expect(Number("1.10")).toBe(Number("1.1"));
    expect(apiVersionsMatch("1.10", "1.1")).toBe(false);
    expect(apiVersionsMatch("1.1", "1.10")).toBe(false);
  });

  it("counts any difference — a minor-only difference included — as a mismatch", () => {
    expect(apiVersionsMatch("1.0", "1.1")).toBe(false);
    expect(apiVersionsMatch("1.0", "2.0")).toBe(false);
  });

  it("never matches an invalid or missing version, even against itself", () => {
    expect(apiVersionsMatch("bad", "bad")).toBe(false);
    expect(apiVersionsMatch(null, null)).toBe(false);
    expect(apiVersionsMatch(undefined, "1.0")).toBe(false);
  });

  it("the server's own constant is a valid version", () => {
    expect(parseApiVersion(SERVER_API_VERSION)).not.toBeNull();
  });
});

describe("readClientApiVersion", () => {
  const url = "https://central.test/api/v1/version";

  it("reads the header", () => {
    const req = new Request(url, { headers: { [CLIENT_API_VERSION_HEADER]: "1.2" } });
    expect(readClientApiVersion(req)).toBe("1.2");
  });

  it("reads the query string when there is no header", () => {
    expect(readClientApiVersion(new Request(`${url}?clientVersion=1.3`))).toBe("1.3");
  });

  it("prefers the header over the query string", () => {
    const req = new Request(`${url}?clientVersion=9.9`, {
      headers: { [CLIENT_API_VERSION_HEADER]: "1.2" },
    });
    expect(readClientApiVersion(req)).toBe("1.2");
  });

  it("returns null when no version is declared", () => {
    expect(readClientApiVersion(new Request(url))).toBeNull();
  });

  it("returns undefined for a declared but invalid version", () => {
    const req = new Request(url, { headers: { [CLIENT_API_VERSION_HEADER]: "1.0.0" } });
    expect(readClientApiVersion(req)).toBeUndefined();
  });

  it("trims surrounding whitespace before validating", () => {
    const req = new Request(url, { headers: { [CLIENT_API_VERSION_HEADER]: " 1.4 " } });
    expect(readClientApiVersion(req)).toBe("1.4");
  });
});
