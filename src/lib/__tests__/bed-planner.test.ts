import { describe, expect, it } from "vitest";
import {
  freeBedsWords,
  guestWords,
  lodgeNights,
  nightInWords,
  nightLabel,
  nightLevel,
  nightsInWords,
  partySize,
  plannerWindow,
  weekendStays,
} from "@/lib/bed-planner";
import { AGE_GROUPS, addDays, estimateStay, priceNights, type PublicLodge, type SearchQuery } from "@/lib/lodge-search";

/** The bed planner's pure parts (#25). */

describe("plannerWindow", () => {
  it("shows two nights before arrival and at least seven nights, the stay inside", () => {
    const w = plannerWindow("2026-12-18", "2026-12-21", "2026-10-17");
    expect(w.from).toBe("2026-12-16");
    expect(w.to).toBe("2026-12-23");
    expect(w.nights).toHaveLength(7);
  });

  it("starts today when arrival is tomorrow, and fits a thirty-night stay that starts today", () => {
    expect(plannerWindow("2026-10-18", "2026-10-20", "2026-10-17").from).toBe("2026-10-17");
    const month = plannerWindow("2026-10-17", "2026-11-16", "2026-10-17");
    expect([month.from, month.to, month.nights.length]).toEqual(["2026-10-17", "2026-11-16", 30]);
  });

  it("never starts before today", () => {
    expect(plannerWindow("2026-10-18", "2026-10-19", "2026-10-17").from).toBe("2026-10-17");
    expect(plannerWindow("2026-10-17", "2026-10-19", "2026-10-17").from).toBe("2026-10-17");
  });

  it("grows to fit a long stay, and gives up nights before arrival to stay within thirty", () => {
    const ten = plannerWindow("2026-12-10", "2026-12-20", "2026-10-17");
    expect([ten.from, ten.to]).toEqual(["2026-12-08", "2026-12-20"]);
    const thirty = plannerWindow("2026-12-10", "2027-01-09", "2026-10-17");
    expect(thirty.nights).toHaveLength(30);
    expect([thirty.from, thirty.to]).toEqual(["2026-12-10", "2027-01-09"]);
    const twentyNine = plannerWindow("2026-12-10", "2027-01-08", "2026-10-17");
    expect([twentyNine.from, twentyNine.to]).toEqual(["2026-12-09", "2027-01-08"]);
  });
});

describe("lodgeNights", () => {
  const stay = { checkIn: "2026-12-18", checkOut: "2026-12-20" };
  const nights = new Map([
    ["2026-12-17", 2],
    ["2026-12-18", 9],
    ["2026-12-19", 5],
  ]);

  it("takes the stay's free beds from the window's nights: the fewest of the stay's nights only", () => {
    expect(lodgeNights({ freeBeds: 2, nights }, undefined, stay)).toEqual({ nights, stayFreeBeds: 5 });
  });

  it("falls back to the club's answer for the stay when the window answer has no nights", () => {
    expect(lodgeNights({ freeBeds: 2, nights: null }, { freeBeds: 6, nights: null }, stay)).toEqual({
      nights: null,
      stayFreeBeds: 6,
    });
    expect(lodgeNights(undefined, undefined, stay)).toEqual({ nights: null, stayFreeBeds: null });
  });
});

describe("nightLevel", () => {
  it.each([
    [undefined, 4, "unknown"],
    [0, 4, "short"],
    [3, 4, "short"],
    [4, 4, "few"],
    [7, 4, "few"],
    [8, 4, "room"],
    [1, 0, "few"],
  ] as const)("%s free beds for %s guests is %s", (free, guests, level) => {
    expect(nightLevel(free, guests)).toBe(level);
  });
});

describe("priceNights, the one pricing of a stay", () => {
  const lodge = {
    rates: {
      winterRateUnder5: 0, winterRate5To11: 20, winterRate12To17: 30, winterRateAdult: 45,
      summerRateUnder5: 0, summerRate5To11: 14, summerRate12To17: null, summerRateAdult: 28.01,
    },
    winterSeasonStart: "2026-06-01", winterSeasonEnd: "2026-09-30",
    summerSeasonStart: "2026-12-01", summerSeasonEnd: "2027-03-31",
  } as unknown as PublicLodge;
  const query: SearchQuery = {
    checkIn: "2026-11-30",
    checkOut: "2026-12-02",
    guests: { under5: 0, age5to11: 2, age12to17: 0, adults: 2 },
    facilities: [],
  };

  it("prices each night at its season for the groups with guests, in whole cents", () => {
    const [gap, summer] = priceNights(lodge, query);
    expect(gap).toMatchObject({ night: "2026-11-30", season: null, cents: null });
    expect(summer).toMatchObject({ night: "2026-12-01", season: "summer", cents: 8402 });
    expect(summer?.parts).toEqual([
      { label: "Child", plural: "children", count: 2, rate: 14 },
      { label: "Adult", plural: "adults", count: 2, rate: 28.01 },
    ]);
  });

  it("has no price for a night when a group with guests has no rate", () => {
    const youth = { ...query, checkIn: "2026-12-01", guests: { ...query.guests, age12to17: 1 } };
    expect(priceNights(lodge, youth)[0]?.cents).toBeNull();
    expect(estimateStay(lodge, youth)).toMatchObject({ total: null, missing: "incomplete" });
  });

  it("totals the stay as the sum of its nights, so the panel's rows add up", () => {
    const summerStay = { ...query, checkIn: "2026-12-01", checkOut: "2026-12-04" };
    const rows = priceNights(lodge, summerStay);
    expect(estimateStay(lodge, summerStay).total).toBe(rows.reduce((s, n) => s + n.cents!, 0) / 100);
    expect(estimateStay(lodge, summerStay).total).toBe(252.06);
    expect(estimateStay(lodge, query)).toMatchObject({ total: null, missing: "out-of-season" });
  });
});

describe("weekendStays", () => {
  it.each([
    ["2026-10-14", "2026-10-16", "2026-10-18"], // Wednesday
    ["2026-10-16", "2026-10-16", "2026-10-18"], // Friday
    ["2026-10-17", "2026-10-17", "2026-10-18"], // Saturday: Saturday night only
    ["2026-10-18", "2026-10-23", "2026-10-25"], // Sunday: the coming weekend
  ])("from %s, this weekend is %s to %s", (today, checkIn, checkOut) => {
    const { thisWeekend, nextWeekend } = weekendStays(today);
    expect(thisWeekend).toEqual({ checkIn, checkOut });
    expect(nextWeekend.checkOut).toBe(addDays(thisWeekend.checkOut, 7));
  });
});

describe("words", () => {
  it("names nights and groups plainly", () => {
    expect(nightLabel("2026-12-18")).toEqual({ weekday: "Fri", day: "18" });
    expect(nightInWords("2026-12-18")).toBe("Fri 18 Dec");
    const [infant, child, youth, adult] = AGE_GROUPS;
    expect(guestWords(child, 2)).toBe("2 children");
    expect(guestWords(youth, 3)).toBe("3 youth");
    expect(guestWords(adult, 1)).toBe("1 adult");
    expect(guestWords(infant, 2)).toBe("2 infants");
    expect(freeBedsWords(1)).toBe("1 free bed");
    expect(freeBedsWords(4)).toBe("4 free beds");
    expect(nightsInWords(["2026-12-18", "2026-12-19"])).toBe("nights of Fri 18 Dec to Sat 19 Dec");
    expect(nightsInWords(["2026-10-17"])).toBe("night of Sat 17 Oct");
    expect(partySize({ under5: 0, age5to11: 0, age12to17: 0, adults: 0 })).toBe(1);
  });
});
