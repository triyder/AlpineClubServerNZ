import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

describe("rate-limit", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests up to the limit then blocks", () => {
    const key = "k";
    const now = 1_000;
    const max = 3;
    const window = 1000;

    expect(checkRateLimit(key, now, max, window).allowed).toBe(true);
    expect(checkRateLimit(key, now, max, window).allowed).toBe(true);
    const third = checkRateLimit(key, now, max, window);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = checkRateLimit(key, now, max, window);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("resets after the window elapses", () => {
    const key = "k";
    expect(checkRateLimit(key, 0, 1, 1000).allowed).toBe(true);
    expect(checkRateLimit(key, 500, 1, 1000).allowed).toBe(false);
    // Past the reset boundary a fresh window opens.
    expect(checkRateLimit(key, 1000, 1, 1000).allowed).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    expect(checkRateLimit("a", 0, 1, 1000).allowed).toBe(true);
    expect(checkRateLimit("b", 0, 1, 1000).allowed).toBe(true);
    expect(checkRateLimit("a", 0, 1, 1000).allowed).toBe(false);
  });
});
