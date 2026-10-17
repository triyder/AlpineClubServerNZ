import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bed planner's questions to the clubs (#25): one per lodge for the grid's
 * window, and a second, for the stay alone, only for a club that did not
 * answer night by night. And `/book/nights`, the home page's weekend grid.
 */

const mocks = vi.hoisted(() => ({
  loadAvailabilityTargets: vi.fn(),
  fetchFreeBeds: vi.fn(),
  loadPublicLodgeRecords: vi.fn(),
  checkRateLimit: vi.fn(),
  todayInNz: vi.fn(),
}));
vi.mock("@/lib/club-availability", () => ({
  loadAvailabilityTargets: mocks.loadAvailabilityTargets,
  fetchFreeBeds: mocks.fetchFreeBeds,
}));
vi.mock("@/lib/public-lodges", () => ({ loadPublicLodgeRecords: mocks.loadPublicLodgeRecords }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/api-auth", () => ({ clientIp: (req: Request) => req.headers.get("x-forwarded-for") }));
vi.mock("@/lib/lodge-search", async (original) => ({
  ...(await original<typeof import("@/lib/lodge-search")>()),
  todayInNz: mocks.todayInNz,
  // The records are given as public lodges already.
  toPublicLodge: (record: unknown) => record,
}));

import { askNights, loadPlanner } from "@/lib/bed-planner-data";
import { plannerWindow } from "@/lib/bed-planner";
import { GET } from "@/app/book/nights/route";
import type { PublicLodge } from "@/lib/lodge-search";

const lodge = (id: string) => ({ id, name: `Lodge ${id}`, location: null }) as unknown as PublicLodge;
const target = (lodgeId: string) => ({ lodgeId, clubId: `club-${lodgeId}`, pushUrl: "https://x.example/p", pushSecretVersion: 1 });
const stay = { checkIn: "2026-12-18", checkOut: "2026-12-20" };
const window = plannerWindow(stay.checkIn, stay.checkOut, "2026-10-17");
const nightsFor = (from: string, n: number, beds: number) =>
  new Map(Array.from({ length: n }, (_, i) => [window.nights[window.nights.indexOf(from) + i]!, beds]));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadAvailabilityTargets.mockImplementation(async (ids: string[]) => ids.map(target));
  mocks.checkRateLimit.mockReturnValue({ allowed: true });
  mocks.todayInNz.mockReturnValue("2026-10-17");
});

describe("askNights", () => {
  it("asks each lodge once for the window, and again for the stay only when no nights came back", async () => {
    mocks.fetchFreeBeds
      .mockResolvedValueOnce(
        new Map([
          ["a", { freeBeds: 3, nights: nightsFor(window.from, 7, 3) }],
          ["b", { freeBeds: 1, nights: null }],
        ]),
      )
      .mockResolvedValueOnce(new Map([["b", { freeBeds: 6, nights: null }]]));

    const result = await askNights([lodge("a"), lodge("b"), lodge("c")], window, stay);

    expect(mocks.fetchFreeBeds.mock.calls[0]?.[1]).toEqual({ from: window.from, to: window.to });
    // The second question goes only to the club that sent no nights.
    expect(mocks.fetchFreeBeds.mock.calls[1]?.[0].map((t: { lodgeId: string }) => t.lodgeId)).toEqual(["b"]);
    expect(mocks.fetchFreeBeds.mock.calls[1]?.[1]).toEqual({ from: stay.checkIn, to: stay.checkOut });
    expect(result.get("a")?.stayFreeBeds).toBe(3);
    expect(result.get("b")).toEqual({ nights: null, stayFreeBeds: 6 });
    expect(result.get("c")).toEqual({ nights: null, stayFreeBeds: null });
  });

  it("asks only once when the window is the stay", async () => {
    mocks.fetchFreeBeds.mockResolvedValueOnce(new Map([["a", { freeBeds: 4, nights: null }]]));
    const range = { from: stay.checkIn, to: stay.checkOut, nights: [] };
    const result = await askNights([lodge("a")], range, stay);
    expect(mocks.fetchFreeBeds).toHaveBeenCalledTimes(1);
    expect(result.get("a")).toEqual({ nights: null, stayFreeBeds: 4 });
  });
});

describe("loadPlanner", () => {
  const full = (id: string) =>
    ({
      ...lodge(id),
      bedCapacity: 20,
      facilities: [],
      rates: {},
      winterSeasonStart: null,
      winterSeasonEnd: null,
      summerSeasonStart: null,
      summerSeasonEnd: null,
    }) as unknown as PublicLodge;

  it("hides a lodge whose KNOWN free beds are too few for the party, keeps an unknown one, and attaches the nights", async () => {
    mocks.loadPublicLodgeRecords.mockResolvedValue([full("tight"), full("silent"), full("roomy")]);
    const stayNights = (beds: number) => new Map(window.nights.map((n) => [n, beds]));
    mocks.fetchFreeBeds.mockResolvedValueOnce(
      new Map([
        ["tight", { freeBeds: 1, nights: stayNights(1) }],
        ["roomy", { freeBeds: 9, nights: stayNights(9) }],
      ]),
    );
    const query = { ...stay, guests: { under5: 0, age5to11: 0, age12to17: 0, adults: 2 }, facilities: [] };
    const { results } = await loadPlanner(query, "2026-10-17");
    expect(results.map((r) => r.lodge.id)).toEqual(["roomy", "silent"]);
    expect(results[0]?.availableBeds).toBe(9);
    expect(results[0]?.availability.nights?.size).toBe(7);
    expect(results[1]?.availability).toEqual({ nights: null, stayFreeBeds: null });
  });
});

describe("GET /book/nights", () => {
  const call = (query: string) => GET(new Request(`https://central.example/book/nights?${query}`));

  it.each([
    ["no dates", ""],
    ["a night in the past", "from=2026-10-16&to=2026-10-18"],
    ["no nights", "from=2026-10-20&to=2026-10-20"],
    ["more than a week", "from=2026-10-20&to=2026-10-28"],
    ["a date that is not real", "from=2026-02-30&to=2026-03-01"],
    ["more than two years ahead", "from=2028-10-20&to=2028-10-22"],
  ])("refuses %s, asking no club and using none of the caller's limit", async (_label, query) => {
    expect((await call(query)).status).toBe(400);
    expect(mocks.fetchFreeBeds).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("allows each caller address only a few requests per window", async () => {
    mocks.loadPublicLodgeRecords.mockResolvedValue([]);
    mocks.fetchFreeBeds.mockResolvedValue(new Map());
    await GET(new Request("https://central.example/book/nights?from=2026-10-23&to=2026-10-25", { headers: { "x-forwarded-for": "203.0.113.9" } }));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("book:nights:203.0.113.9", expect.any(Number), 10);
  });

  it("shares one round of questions between requests for the same nights that overlap, then forgets it", async () => {
    mocks.loadPublicLodgeRecords.mockResolvedValue([lodge("a")]);
    let release!: (value: Map<string, unknown>) => void;
    mocks.fetchFreeBeds.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = call("from=2026-10-23&to=2026-10-25");
    const second = call("from=2026-10-23&to=2026-10-25");
    await new Promise((r) => setTimeout(r, 0));
    release(new Map([["a", { freeBeds: 5, nights: new Map([["2026-10-23", 5], ["2026-10-24", 6]]) }]]));
    const [a, b] = await Promise.all([first, second]);
    expect(await a.json()).toEqual(await b.json());
    expect(mocks.fetchFreeBeds).toHaveBeenCalledTimes(1);

    // Once answered, nothing is kept: the next request asks again.
    mocks.fetchFreeBeds.mockResolvedValueOnce(new Map());
    await call("from=2026-10-23&to=2026-10-25");
    expect(mocks.fetchFreeBeds).toHaveBeenCalledTimes(2);
  });

  it("is rate-limited per caller, asking no club when over", async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false });
    const res = await call("from=2026-10-23&to=2026-10-25");
    expect(res.status).toBe(429);
    expect(mocks.fetchFreeBeds).not.toHaveBeenCalled();
  });

  it("answers every public lodge's free beds by night, uncached, a silent club's nights left out", async () => {
    mocks.loadPublicLodgeRecords.mockResolvedValue([lodge("a"), lodge("b")]);
    mocks.fetchFreeBeds.mockResolvedValueOnce(
      new Map([["a", { freeBeds: 5, nights: new Map([["2026-10-23", 5], ["2026-10-24", 8]]) }]]),
    );
    const res = await call("from=2026-10-23&to=2026-10-25");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      from: "2026-10-23",
      to: "2026-10-25",
      lodges: [
        { id: "a", name: "Lodge a", location: null, nights: { "2026-10-23": 5, "2026-10-24": 8 } },
        { id: "b", name: "Lodge b", location: null, nights: {} },
      ],
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("book:nights:unknown", expect.any(Number), 10);
  });
});
