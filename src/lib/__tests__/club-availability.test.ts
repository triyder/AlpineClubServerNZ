import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Asking club booking sites for free beds (Phase D).
 *
 * The contract with the booking app (triyder/AlpineClubBookingsNZ#62) is
 * pinned literally here: the path at the push URL's ORIGIN, the query, the
 * two headers, and an HMAC over exactly `${timestamp}.availability\n<id>\n
 * <from>\n<to>` with the club's push secret. Anything else that goes wrong
 * must read as "unknown", never as a number.
 */

const mocks = vi.hoisted(() => ({
  assertPublicDestination: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/push-targets", () => ({ assertPublicDestination: mocks.assertPublicDestination }));
vi.mock("@/lib/db", () => ({ prisma: { otherLodge: { findMany: mocks.findMany } } }));

import {
  askClubForFreeBeds,
  availabilitySignedText,
  fetchFreeBeds,
  loadAvailabilityTargets,
  type AvailabilityTarget,
} from "@/lib/club-availability";
import { derivePushSecret } from "@/lib/push-delivery";

const KEY = "k".repeat(40);
const TARGET: AvailabilityTarget = {
  lodgeId: "ol_a",
  clubId: "club_1",
  pushUrl: "https://bookings.club.example/api/webhooks/servernz-posts",
  pushSecretVersion: 2,
};
const STAY = { from: "2026-07-10", to: "2026-07-13" };

const fetchMock = vi.fn();
function answer(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ status, json: async () => body });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PUSH_SIGNING_KEY = KEY;
  mocks.assertPublicDestination.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  answer(200, { lodgeId: "ol_a", from: STAY.from, to: STAY.to, freeBeds: 7 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PUSH_SIGNING_KEY;
});

describe("askClubForFreeBeds", () => {
  it("asks the booking app's route at the push URL's origin, signed as the booking app verifies", async () => {
    expect(await askClubForFreeBeds(TARGET, STAY)).toBe(7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://bookings.club.example/api/webhooks/servernz-availability?lodgeId=ol_a&from=2026-07-10&to=2026-07-13",
    );
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });

    const timestamp = init.headers["X-Acs-Timestamp"];
    // Computed independently of the module: the club's derived secret over the
    // canonical text the booking app rebuilds from the decoded query.
    const secret = createHmac("sha256", KEY).update("club_1:2").digest("hex");
    expect(secret).toBe(derivePushSecret("club_1", 2));
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.availability\nol_a\n2026-07-10\n2026-07-13`)
      .digest("hex");
    expect(init.headers["X-Acs-Signature"]).toBe(expected);
    expect(mocks.assertPublicDestination).toHaveBeenCalledWith(String(url));
  });

  it("builds the signed text exactly as the booking app does", () => {
    expect(availabilitySignedText({ lodgeId: "ol_a", ...STAY })).toBe(
      "availability\nol_a\n2026-07-10\n2026-07-13",
    );
  });

  it.each([
    ["the club answers 404", () => answer(404, { error: "Lodge not available" })],
    ["the club answers 401", () => answer(401, { error: "Invalid signature" })],
    ["the club redirects", () => answer(302, {})],
    ["the answer is about another lodge", () => answer(200, { lodgeId: "ol_b", ...STAY, freeBeds: 7 })],
    ["the answer is about other dates", () => answer(200, { lodgeId: "ol_a", from: STAY.from, to: "2026-07-20", freeBeds: 7 })],
    ["the bed count is negative", () => answer(200, { lodgeId: "ol_a", ...STAY, freeBeds: -1 })],
    ["the bed count is not a whole number", () => answer(200, { lodgeId: "ol_a", ...STAY, freeBeds: 2.5 })],
    ["the body is not JSON", () => fetchMock.mockResolvedValue({ status: 200, json: async () => { throw new Error("bad json"); } })],
    ["the request times out or fails", () => fetchMock.mockRejectedValue(new Error("timeout"))],
    ["the destination check refuses the address", () => mocks.assertPublicDestination.mockRejectedValue(new Error("private network"))],
    ["there is no signing key", () => { delete process.env.PUSH_SIGNING_KEY; }],
  ])("is unknown (null), never a number, when %s", async (_label, arrange) => {
    arrange();
    expect(await askClubForFreeBeds(TARGET, STAY)).toBeNull();
  });

  it("does not call the club at all when the destination is refused", async () => {
    mocks.assertPublicDestination.mockRejectedValue(new Error("private network"));
    await askClubForFreeBeds(TARGET, STAY);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchFreeBeds", () => {
  it("returns the answers by lodge id and leaves out the lodges whose club did not answer", async () => {
    const targets = ["a", "b", "c"].map((id) => ({ ...TARGET, lodgeId: id }));
    const ask = vi.fn(async (t: AvailabilityTarget) => (t.lodgeId === "b" ? null : 3));
    const result = await fetchFreeBeds(targets, STAY, ask);
    expect([...result.entries()].sort()).toEqual([
      ["a", 3],
      ["c", 3],
    ]);
  });

  it("asks at most six clubs at once, and every target once", async () => {
    let inFlight = 0;
    let peak = 0;
    const ask = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 1;
    });
    const targets = Array.from({ length: 20 }, (_, i) => ({ ...TARGET, lodgeId: `l${i}` }));
    const result = await fetchFreeBeds(targets, STAY, ask);
    expect(ask).toHaveBeenCalledTimes(20);
    expect(result.size).toBe(20);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("asks nobody for no targets", async () => {
    const ask = vi.fn();
    expect((await fetchFreeBeds([], STAY, ask)).size).toBe(0);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("loadAvailabilityTargets", () => {
  it("asks only about approved clubs with a live push target, and only for the lodges given", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "ol_a", sourceClub: { id: "club_1", pushUrl: "https://a.example/p", pushSecretVersion: 1 } },
      { id: "ol_b", sourceClub: null },
    ]);
    const targets = await loadAvailabilityTargets(["ol_a", "ol_b"]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["ol_a", "ol_b"] },
          deletedAt: null,
          sourceClub: { status: "APPROVED", pushEnabled: true, pushUrl: { not: null } },
        },
      }),
    );
    expect(targets).toEqual([
      { lodgeId: "ol_a", clubId: "club_1", pushUrl: "https://a.example/p", pushSecretVersion: 1 },
    ]);
  });

  it("does not query for no lodges", async () => {
    expect(await loadAvailabilityTargets([])).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
