import { describe, expect, it } from "vitest";
import { hasSeasons, seasonDatesProblem, seasonForNight, seasonSpanText } from "@/lib/lodge-seasons";

/** Seasons with end dates (owner, 16 Oct 2026): winter Jun–Sep, summer Dec–Mar. */
const BOTH = {
  winterSeasonStart: "2026-06-01",
  winterSeasonEnd: "2026-09-30",
  summerSeasonStart: "2026-12-01",
  summerSeasonEnd: "2027-03-31",
};

describe("seasonForNight with end dates", () => {
  it.each([
    ["2026-06-01", "winter"], // the start day
    ["2026-09-30", "winter"], // the end day is the season's last
    ["2026-10-01", null], // the gap between the seasons
    ["2026-11-30", null],
    ["2026-12-01", "summer"],
    ["2027-01-15", "summer"], // across New Year
    ["2027-03-31", "summer"],
    ["2027-04-01", null],
    ["2031-07-04", "winter"], // recurs: the year is ignored
  ] as const)("%s is %s", (night, season) => {
    expect(seasonForNight(night, BOTH)).toBe(season);
  });

  it("runs a season with no end up to the other season's start, as before end dates", () => {
    const winterOpen = { ...BOTH, winterSeasonEnd: null };
    expect(seasonForNight("2026-11-30", winterOpen)).toBe("winter");
    expect(seasonForNight("2026-12-01", winterOpen)).toBe("summer");
    const neither = { winterSeasonStart: "2026-06-01", summerSeasonStart: "2026-11-01" };
    expect(seasonForNight("2026-10-31", neither)).toBe("winter");
    expect(seasonForNight("2027-05-31", neither)).toBe("summer");
  });

  it("knows a season with an end even when the other season has no dates", () => {
    const winterOnly = { winterSeasonStart: "2026-06-01", winterSeasonEnd: "2026-09-30" };
    expect(seasonForNight("2026-07-01", winterOnly)).toBe("winter");
    expect(seasonForNight("2026-12-25", winterOnly)).toBeNull();
  });

  it("has no season at all without a start date", () => {
    expect(seasonForNight("2026-07-01", {})).toBeNull();
    expect(seasonForNight("2026-07-01", { winterSeasonStart: "2026-06-01" })).toBeNull();
  });

  it("keeps a single-day season (start and end) only when inclusive", () => {
    // Refused at save, but read safely: the one day is in the season.
    expect(seasonForNight("2026-06-01", { winterSeasonStart: "2026-06-01", winterSeasonEnd: "2027-06-01" })).toBe("winter");
  });
});

describe("seasonDatesProblem", () => {
  it("accepts seasons with a gap, with ends missing, or with nothing set", () => {
    expect(seasonDatesProblem(BOTH)).toBeNull();
    expect(seasonDatesProblem({ ...BOTH, winterSeasonEnd: null, summerSeasonEnd: null })).toBeNull();
    expect(seasonDatesProblem({})).toBeNull();
  });

  it("accepts seasons that touch but do not share a day", () => {
    expect(
      seasonDatesProblem({ ...BOTH, winterSeasonEnd: "2026-11-30" }),
    ).toBeNull();
  });

  it.each([
    ["the seasons share days", { ...BOTH, winterSeasonEnd: "2026-12-15" }, /overlap: both include 1 December/],
    ["a summer crossing into winter", { ...BOTH, summerSeasonEnd: "2027-06-10" }, /overlap: both include 1 June/],
    ["an end before the other season's start overlapping by fallback", { winterSeasonStart: "2026-06-01", summerSeasonStart: "2026-08-01", summerSeasonEnd: "2026-07-01" }, /overlap/],
    ["an end with no start", { winterSeasonEnd: "2026-09-30" }, /winter season has an end date but no start date/],
    ["a start and end on the same day", { summerSeasonStart: "2026-12-01", summerSeasonEnd: "2027-12-01" }, /summer season's start and end dates must be different days/],
  ] as const)("refuses %s", (_label, dates, message) => {
    expect(seasonDatesProblem(dates)).toMatch(message);
  });
});

describe("seasonSpanText and hasSeasons", () => {
  it("names each season's days, ending the day before the other starts without an end", () => {
    expect(seasonSpanText(BOTH, "winter")).toBe("1 June to 30 September");
    expect(seasonSpanText(BOTH, "summer")).toBe("1 December to 31 March");
    expect(seasonSpanText({ ...BOTH, winterSeasonEnd: null }, "winter")).toBe("1 June to 30 November");
    expect(seasonSpanText({}, "winter")).toBeNull();
  });

  it("says whether any season can be placed", () => {
    expect(hasSeasons(BOTH)).toBe(true);
    expect(hasSeasons({ winterSeasonStart: "2026-06-01" })).toBe(false);
    expect(hasSeasons({})).toBe(false);
  });
});
