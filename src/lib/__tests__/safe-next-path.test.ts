import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath: where sign-in may return to", () => {
  it("keeps a console path, with its query", () => {
    expect(safeNextPath("/clubs/review/cl_123")).toBe("/clubs/review/cl_123");
    expect(safeNextPath("/posts?status=hidden")).toBe("/posts?status=hidden");
    expect(safeNextPath("/clubs")).toBe("/clubs");
  });

  it("refuses anything that could leave the site", () => {
    for (const raw of [
      "https://evil.example/clubs",
      "//evil.example/clubs",
      "/\evil.example/clubs",
      "\\evil.example",
      "javascript:alert(1)",
      "/clubs\n/x",
      " /clubs",
    ]) {
      expect(safeNextPath(raw)).toBeNull();
    }
  });

  it("refuses paths outside the console and non-strings", () => {
    expect(safeNextPath("/book")).toBeNull();
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/clubsx")).toBeNull();
    expect(safeNextPath("/")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("/clubs/" + "a".repeat(600))).toBeNull();
  });

  it("does not let dot segments climb out of the console", () => {
    expect(safeNextPath("/clubs/../book")).toBeNull();
  });
});
