import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  eachNight,
  estimateStay,
  parseSearchParams,
  publicLodgeSelect,
  searchLodges,
  seasonForNight,
  todayInNz,
  toPublicLodge,
  type PublicLodge,
  type PublicLodgeRecord,
  type SearchQuery,
} from "@/lib/lodge-search";
import { LODGE_RATE_FIELDS, parseLodgeDate } from "@/lib/other-lodges";

const TODAY = "2026-10-12";

const noRates = Object.fromEntries(LODGE_RATE_FIELDS.map((k) => [k, null])) as PublicLodge["rates"];

function lodge(over: Partial<PublicLodge> = {}): PublicLodge {
  return {
    id: "l1",
    name: "Lodge",
    location: null,
    bedCapacity: 20,
    doubleBeds: null,
    singleBeds: null,
    cancellationPeriod: null,
    canBook: true,
    facilities: [],
    amenities: [],
    rates: noRates,
    winterSeasonStart: null,
    winterSeasonEnd: null,
    summerSeasonStart: null,
    summerSeasonEnd: null,
    picture: null,
    ...over,
  };
}

function query(over: Partial<SearchQuery> = {}): SearchQuery {
  return {
    checkIn: "2026-11-01",
    checkOut: "2026-11-03",
    guests: { under5: 0, age5to11: 0, age12to17: 0, adults: 2 },
    facilities: [],
    ...over,
  };
}

describe("parseSearchParams", () => {
  it("is 'empty' with no dates, defaulting to two adults", () => {
    const p = parseSearchParams({}, TODAY);
    expect(p.state).toBe("empty");
    expect(p.form.guests).toEqual({ under5: "0", age5to11: "0", age12to17: "0", adults: "2" });
  });

  it("reads a valid search with every age group and the ticked facilities", () => {
    const p = parseSearchParams(
      {
        checkIn: "2026-11-01",
        checkOut: "2026-11-04",
        under5: "1",
        age5to11: "2",
        age12to17: "0",
        adults: "2",
        facility: ["freeWifi", "dryingRoom", "notAFacility"],
      },
      TODAY,
    );
    expect(p.state).toBe("ok");
    if (p.state !== "ok") return;
    expect(p.query.guests).toEqual({ under5: 1, age5to11: 2, age12to17: 0, adults: 2 });
    // Unknown names are dropped, not refused; list order is the fixed order.
    expect(p.query.facilities).toEqual(["freeWifi", "dryingRoom"]);
  });

  it("accepts a stay starting today", () => {
    expect(parseSearchParams({ checkIn: TODAY, checkOut: "2026-10-13" }, TODAY).state).toBe("ok");
  });

  it.each([
    ["a past check-in", { checkIn: "2026-10-11", checkOut: "2026-10-13" }, "past"],
    ["check-out before check-in", { checkIn: "2026-11-05", checkOut: "2026-11-04" }, "after check-in"],
    ["check-out equal to check-in", { checkIn: "2026-11-05", checkOut: "2026-11-05" }, "after check-in"],
    ["more than 30 nights", { checkIn: "2026-11-01", checkOut: "2026-12-02" }, "30 nights"],
    ["an impossible date", { checkIn: "2026-02-30", checkOut: "2026-03-02" }, "check-in and a check-out"],
    ["a missing check-out", { checkIn: "2026-11-01" }, "check-in and a check-out"],
    ["no guests", { checkIn: "2026-11-01", checkOut: "2026-11-02", adults: "0" }, "at least one guest"],
    ["a fractional guest count", { checkIn: "2026-11-01", checkOut: "2026-11-02", adults: "1.5" }, "whole numbers"],
    ["a negative guest count", { checkIn: "2026-11-01", checkOut: "2026-11-02", adults: "-1" }, "whole numbers"],
    ["too many guests", { checkIn: "2026-11-01", checkOut: "2026-11-02", adults: "30", age5to11: "30" }, "at most 50 guests"],
    ["a check-in years ahead", { checkIn: "2029-01-01", checkOut: "2029-01-02" }, "too far ahead"],
  ])("refuses %s", (_label, params, message) => {
    const p = parseSearchParams(params, TODAY);
    expect(p.state).toBe("invalid");
    if (p.state === "invalid") expect(p.errors.join(" ")).toContain(message);
  });
});

describe("dates", () => {
  it("lists each night from check-in up to (not including) check-out, across a month end", () => {
    expect(eachNight("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("takes today from New Zealand, not UTC", () => {
    // 12:30 UTC on 12 October is already 13 October in New Zealand (NZDT).
    expect(todayInNz(new Date("2026-10-12T12:30:00Z"))).toBe("2026-10-13");
    expect(todayInNz(new Date("2026-10-12T10:00:00Z"))).toBe("2026-10-12");
  });
});

describe("seasonForNight", () => {
  const W = "2026-06-01";
  const S = "2026-11-01";

  it.each([
    ["2026-06-01", "winter"],
    ["2026-10-31", "winter"],
    ["2026-11-01", "summer"],
    ["2027-01-15", "summer"],
    ["2027-05-31", "summer"],
    // Seasons recur: the start dates' year is ignored.
    ["2028-07-04", "winter"],
  ])("%s is %s", (night, season) => {
    expect(seasonForNight(night, { winterSeasonStart: W, summerSeasonStart: S })).toBe(season);
  });

  it("handles a winter that starts later in the year than summer", () => {
    expect(seasonForNight("2026-12-15", { winterSeasonStart: "2026-12-01", summerSeasonStart: "2026-03-01" })).toBe("winter");
    expect(seasonForNight("2026-02-10", { winterSeasonStart: "2026-12-01", summerSeasonStart: "2026-03-01" })).toBe("winter");
    expect(seasonForNight("2026-05-01", { winterSeasonStart: "2026-12-01", summerSeasonStart: "2026-03-01" })).toBe("summer");
  });

  it("is null without both season dates", () => {
    expect(seasonForNight("2026-07-01", { winterSeasonStart: W, summerSeasonStart: null })).toBeNull();
    expect(seasonForNight("2026-07-01", { winterSeasonStart: null, summerSeasonStart: S })).toBeNull();
  });
});

describe("estimateStay", () => {
  const seasons = { winterSeasonStart: "2026-06-01", summerSeasonStart: "2026-11-01" };
  const rates = {
    ...noRates,
    winterRateAdult: 45.5,
    winterRate5To11: 20,
    summerRateAdult: 30.1,
    summerRate5To11: 15,
  };

  it("prices each night at its own season, for each age group with guests", () => {
    // 30 Oct (winter), 31 Oct (winter), 1 Nov (summer).
    const est = estimateStay(
      lodge({ ...seasons, rates }),
      query({
        checkIn: "2026-10-30",
        checkOut: "2026-11-02",
        guests: { under5: 0, age5to11: 1, age12to17: 0, adults: 2 },
      }),
    );
    // Winter: 2 × 45.50 + 20 = 111 a night, × 2. Summer: 2 × 30.10 + 15 = 75.20.
    expect(est).toEqual({ nights: 3, total: 297.2 });
  });

  it("ignores a missing rate for an age group with no guests", () => {
    expect(estimateStay(lodge({ ...seasons, rates }), query()).total).toBe(120.4);
  });

  it("has no total when a needed rate is missing", () => {
    const est = estimateStay(
      lodge({ ...seasons, rates }),
      query({ guests: { under5: 1, age5to11: 0, age12to17: 0, adults: 2 } }),
    );
    expect(est).toEqual({ nights: 2, total: null, missing: "incomplete" });
  });

  it("says a stay in the gap between seasons is out of season (#season end dates)", () => {
    const gapLodge = lodge({
      rates,
      winterSeasonStart: "2026-06-01",
      winterSeasonEnd: "2026-09-30",
      summerSeasonStart: "2026-12-01",
      summerSeasonEnd: "2027-03-31",
    });
    const est = estimateStay(gapLodge, query({ checkIn: "2026-10-10", checkOut: "2026-10-12" }));
    expect(est).toEqual({ nights: 2, total: null, missing: "out-of-season" });
  });

  it("has no total without season dates", () => {
    expect(estimateStay(lodge({ rates }), query()).missing).toBe("incomplete");
    expect(estimateStay(lodge({ rates }), query()).total).toBeNull();
  });

  it("adds in whole cents, so a long stay has no float error", () => {
    const est = estimateStay(
      lodge({ ...seasons, rates: { ...noRates, summerRateAdult: 0.1 } }),
      query({ checkIn: "2026-11-01", checkOut: "2026-12-01", guests: { under5: 0, age5to11: 0, age12to17: 0, adults: 3 } }),
    );
    expect(est.total).toBe(9);
  });
});

describe("searchLodges", () => {
  const big = lodge({ id: "big", name: "Big", bedCapacity: 30, facilities: ["freeWifi", "dryingRoom"] });
  const small = lodge({ id: "small", name: "Small", bedCapacity: 3, facilities: ["freeWifi"] });
  const unknownSize = lodge({ id: "unk", name: "Unknown size", bedCapacity: null });
  const all = [unknownSize, small, big];

  it("hides a lodge whose total beds are fewer than the guests, but not one of unknown size", () => {
    const ids = searchLodges(all, query({ guests: { under5: 1, age5to11: 1, age12to17: 1, adults: 2 } })).map((r) => r.lodge.id);
    expect(ids).toEqual(["big", "unk"]);
  });

  it("hides a lodge missing any ticked facility", () => {
    expect(searchLodges(all, query({ facilities: ["freeWifi"] })).map((r) => r.lodge.id)).toEqual(["big", "small"]);
    expect(searchLodges(all, query({ facilities: ["freeWifi", "dryingRoom"] })).map((r) => r.lodge.id)).toEqual(["big"]);
  });

  it("hides a lodge whose KNOWN free beds are too few; unknown never hides", () => {
    const results = searchLodges(all, query({ guests: { under5: 0, age5to11: 0, age12to17: 0, adults: 3 } }), new Map([["big", 2]]));
    expect(results.map((r) => r.lodge.id)).toEqual(["small", "unk"]);
    expect(results.every((r) => r.availableBeds === null)).toBe(true);
  });

  it("sorts lodges with known availability first, then by name", () => {
    const results = searchLodges(all, query(), new Map([["small", 3]]));
    expect(results.map((r) => [r.lodge.id, r.availableBeds])).toEqual([
      ["small", 3],
      ["big", null],
      ["unk", null],
    ]);
  });
});

describe("the public lodge shape", () => {
  const record = {
    id: "l1",
    name: "Ruapehu Lodge",
    location: "Whakapapa",
    bedCapacity: 24,
    doubleBeds: 2,
    singleBeds: 20,
    cancellationPeriod: "14 days",
    siteUrl: "https://ruapehu.example/book",
    winterSeasonStart: parseLodgeDate("2026-06-01"),
    summerSeasonStart: null,
    requiresLodgeCustodian: false,
    freeWifi: true,
    quietRoom: false,
    dryingRoom: true,
    sharedKitchen: false,
    wheelchairAccessible: false,
    breakfastIncluded: false,
    lunchIncluded: false,
    dinnerIncluded: false,
    skiWorkshopArea: false,
    gamesRoom: false,
    ...Object.fromEntries(LODGE_RATE_FIELDS.map((k) => [k, null])),
    winterRateAdult: new Prisma.Decimal("45.50"),
    amenities: [{ name: "Sauna", description: null }],
    image: null,
    logo: null,
  } as unknown as PublicLodgeRecord;

  it("never selects private or provenance columns", () => {
    for (const key of [
      "bookingOfficerName",
      "bookingOfficerEmail",
      "bookingOfficerPhone",
      "sourceClub",
      "sourceClubId",
      "lastUpdatedByClub",
      "lastUpdatedByClubId",
      "lastUploadedAt",
      "createdAt",
      "updatedAt",
    ]) {
      expect(publicLodgeSelect, key).not.toHaveProperty(key);
    }
  });

  it("carries no booking URL, only whether there is one", () => {
    const out = toPublicLodge(record);
    expect(out.canBook).toBe(true);
    expect(JSON.stringify(out)).not.toContain("ruapehu.example");
    expect(toPublicLodge({ ...record, siteUrl: null }).canBook).toBe(false);
  });

  it("lists the facilities the lodge has and reads rates and seasons", () => {
    const out = toPublicLodge(record);
    expect(out.facilities).toEqual(["freeWifi", "dryingRoom"]);
    expect(out.rates.winterRateAdult).toBe(45.5);
    expect(out.rates.summerRateAdult).toBeNull();
    expect(out.winterSeasonStart).toBe("2026-06-01");
    expect(out.summerSeasonStart).toBeNull();
  });

  it("uses the image, else the logo, else nothing", () => {
    const image = { id: "i", name: "Lodge", publicId: "a".repeat(32) };
    const logo = { id: "g", name: "Logo", publicId: "b".repeat(32) };
    expect(toPublicLodge({ ...record, image, logo }).picture).toEqual({
      url: expect.stringContaining("a".repeat(32)),
      kind: "image",
    });
    expect(toPublicLodge({ ...record, logo }).picture).toEqual({
      url: expect.stringContaining("b".repeat(32)),
      kind: "logo",
    });
    expect(toPublicLodge(record).picture).toBeNull();
  });
});

describe("guest age groups (owner, 16 Oct 2026)", () => {
  it("are Infant, Child, Youth and Adult, on the same rate fields as before", async () => {
    const { AGE_GROUPS } = await import("@/lib/lodge-search");
    expect(AGE_GROUPS.map((g) => g.label)).toEqual(["Infant", "Child", "Youth", "Adult"]);
    expect(AGE_GROUPS.map((g) => g.winter)).toEqual([
      "winterRateUnder5",
      "winterRate5To11",
      "winterRate12To17",
      "winterRateAdult",
    ]);
  });
});
