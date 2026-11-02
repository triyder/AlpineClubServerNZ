import { describe, it, expect } from "vitest";
import { formatNzDate, formatNzDateTime } from "@/lib/nz-time";

describe("New Zealand display times", () => {
  it("shows a summer moment in NZDT (UTC+13)", () => {
    // The booking app's "2 Nov 2026, 5:21 pm" is 04:21 UTC.
    expect(formatNzDateTime(new Date("2026-11-02T04:21:00Z"))).toBe("2026-11-02 17:21 NZDT");
  });

  it("shows a winter moment in NZST (UTC+12)", () => {
    expect(formatNzDateTime(new Date("2026-07-01T00:05:09Z"), { seconds: true })).toBe(
      "2026-07-01 12:05:09 NZST",
    );
  });

  it("uses the New Zealand calendar date, which can be a day ahead of UTC", () => {
    expect(formatNzDate(new Date("2026-10-30T12:30:00Z"))).toBe("2026-10-31");
  });

  it("writes midnight as 00, not 24", () => {
    expect(formatNzDateTime(new Date("2026-11-01T11:00:00Z"))).toBe("2026-11-02 00:00 NZDT");
  });
});
