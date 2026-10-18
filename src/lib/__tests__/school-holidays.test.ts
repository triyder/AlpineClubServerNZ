import { describe, expect, it } from "vitest";
import { SCHOOL_HOLIDAYS, schoolHolidayStay } from "@/lib/school-holidays";
import { applyQuickPick, quickPickStay } from "@/lib/bed-planner";
import { nightsBetween } from "@/lib/lodge-search";

/** The home page's quick picks (#25): This weekend, Next weekend, School holidays. */

describe("SCHOOL_HOLIDAYS", () => {
  it("is in order, each break a real span that ends before the next begins", () => {
    for (const [i, h] of SCHOOL_HOLIDAYS.entries()) {
      expect(h.first < h.last).toBe(true);
      const next = SCHOOL_HOLIDAYS[i + 1];
      if (next) expect(h.last < next.first).toBe(true);
    }
  });
});

describe("schoolHolidayStay", () => {
  it.each([
    // Before a break: its first week.
    ["2026-10-18", "2026-12-19", "2026-12-26", "Summer 2026–27"],
    ["2027-03-01", "2027-04-10", "2027-04-17", "Autumn 2027"],
    // During a break: a week from today.
    ["2026-12-30", "2026-12-30", "2027-01-06", "Summer 2026–27"],
    // Late in a break: never past its last night.
    ["2027-07-15", "2027-07-15", "2027-07-19", "Winter 2027"],
    // A break's last day: tonight only.
    ["2027-07-18", "2027-07-18", "2027-07-19", "Winter 2027"],
  ])("from %s searches %s to %s (%s)", (today, checkIn, checkOut, name) => {
    expect(schoolHolidayStay(today)).toEqual({ checkIn, checkOut, name });
  });

  it("is never longer than a week, and is null once the list has run out", () => {
    for (const h of SCHOOL_HOLIDAYS) {
      const stay = schoolHolidayStay(h.first)!;
      expect(nightsBetween(stay.checkIn, stay.checkOut)).toBeLessThanOrEqual(7);
    }
    expect(schoolHolidayStay("2028-02-01")).toBeNull();
  });
});

describe("quick picks", () => {
  it("turn `when` into dates, keep the guests, and drop `when` itself", () => {
    const sent = { when: "school-holidays", checkIn: "", checkOut: "", adults: "3", age5to11: "1" };
    expect(applyQuickPick(sent, "2026-10-18")).toEqual({
      checkIn: "2026-12-19",
      checkOut: "2026-12-26",
      adults: "3",
      age5to11: "1",
    });
    expect(applyQuickPick({ when: "this-weekend" }, "2026-10-14")).toEqual({ checkIn: "2026-10-16", checkOut: "2026-10-18" });
    expect(quickPickStay("next-weekend", "2026-10-14")).toEqual({ checkIn: "2026-10-23", checkOut: "2026-10-25" });
  });

  it("leave a search without a known pick as it is", () => {
    const plain = { checkIn: "2026-12-01", checkOut: "2026-12-03" };
    expect(applyQuickPick(plain, "2026-10-18")).toBe(plain);
    expect(applyQuickPick({ ...plain, when: "someday" }, "2026-10-18")).toEqual({ ...plain, when: "someday" });
  });

  it("leaves the dates empty, for the search to ask for them, when no school holidays are listed ahead", () => {
    expect(applyQuickPick({ when: "school-holidays", adults: "2" }, "2028-02-01")).toEqual({ adults: "2" });
  });
});
