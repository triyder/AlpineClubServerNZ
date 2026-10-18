import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bed planner's questions to the clubs (#25): one per lodge for the grid's
 * window, and a second, for the stay alone, only for a club that did not
 * answer night by night.
 */

const mocks = vi.hoisted(() => ({
  loadAvailabilityTargets: vi.fn(),
  fetchFreeBeds: vi.fn(),
  loadPublicLodgeRecords: vi.fn(),
  loadLodgeIdsWithEmail: vi.fn(),
  todayInNz: vi.fn(),
}));
vi.mock("@/lib/club-availability", () => ({
  loadAvailabilityTargets: mocks.loadAvailabilityTargets,
  fetchFreeBeds: mocks.fetchFreeBeds,
}));
vi.mock("@/lib/public-lodges", () => ({
  loadPublicLodgeRecords: mocks.loadPublicLodgeRecords,
  loadLodgeIdsWithEmail: mocks.loadLodgeIdsWithEmail,
}));
vi.mock("@/lib/lodge-search", async (original) => ({
  ...(await original<typeof import("@/lib/lodge-search")>()),
  todayInNz: mocks.todayInNz,
  // The records are given as public lodges already.
  toPublicLodge: (record: unknown) => record,
}));

import { askNights, loadPlanner, plannerGroup, plannerOrder } from "@/lib/bed-planner-data";
import type { SearchResult } from "@/lib/lodge-search";
import { plannerWindow } from "@/lib/bed-planner";
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
  mocks.todayInNz.mockReturnValue("2026-10-17");
  mocks.loadLodgeIdsWithEmail.mockResolvedValue(new Set());
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

describe("plannerOrder (owner, 18 Oct 2026)", () => {
  const result = (name: string, total: number | null, reachable = true) =>
    ({ lodge: { id: name.toLowerCase(), name, reachable }, estimate: { nights: 3, total } }) as unknown as SearchResult;

  it("lists every lodge with a price A to Z, then every unknown price A to Z", () => {
    const sorted = [
      result("Whakapapa Lodge", null),
      result("Ruapehu Hut", 252),
      result("arlberg", null),
      result("Mangatepopo", 0),
      result("Aorangi", 410.5),
      result("Craig's Hut", null),
    ].sort(plannerOrder);
    expect(sorted.map((r) => r.lodge.name)).toEqual([
      "Aorangi",
      "Mangatepopo", // $0.00 is a price
      "Ruapehu Hut",
      "arlberg", // A to Z ignores case
      "Craig's Hut",
      "Whakapapa Lodge",
    ]);
  });
});

describe("the third group: no booking page or email (owner, 18 Oct 2026)", () => {
  const result = (name: string, total: number | null, reachable: boolean) =>
    ({ lodge: { id: name.toLowerCase(), name, reachable }, estimate: { nights: 3, total } }) as unknown as SearchResult;

  it("comes last, A to Z, whatever its price", () => {
    const sorted = [
      result("Zeta", null, false),
      result("Beta", 100, false),
      result("Kappa", null, true),
      result("Alpha", 50, true),
    ].sort(plannerOrder);
    expect(sorted.map((r) => [r.lodge.name, plannerGroup(r)])).toEqual([
      ["Alpha", 0],
      ["Kappa", 1],
      ["Beta", 2],
      ["Zeta", 2],
    ]);
  });

  it("counts a lodge with only an officer's email as reachable, asking for ids and never the address", async () => {
    const bare = { id: "bare", name: "Bare", reachable: false, bedCapacity: 10, facilities: [], rates: {} };
    const mailed = { ...bare, id: "mailed", name: "Mailed" };
    mocks.loadPublicLodgeRecords.mockResolvedValue([bare, mailed]);
    mocks.loadLodgeIdsWithEmail.mockResolvedValue(new Set(["mailed"]));
    mocks.fetchFreeBeds.mockResolvedValue(new Map());
    const query = { checkIn: "2026-12-18", checkOut: "2026-12-20", guests: { under5: 0, age5to11: 0, age12to17: 0, adults: 2 }, facilities: [] };
    const { results } = await loadPlanner(query, "2026-10-17");
    expect(mocks.loadLodgeIdsWithEmail).toHaveBeenCalledWith(["bare", "mailed"]);
    expect(results.map((r) => [r.lodge.id, r.lodge.reachable])).toEqual([
      ["mailed", true],
      ["bare", false],
    ]);
  });
});
