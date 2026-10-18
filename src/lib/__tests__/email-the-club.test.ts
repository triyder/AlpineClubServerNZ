import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Email the club" (owner, 18 Oct 2026): the message, and the route that gives the address. */

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), checkRateLimit: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { otherLodge: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/api-auth", () => ({ clientIp: (req: Request) => req.headers.get("x-forwarded-for") }));

import { BOOKING_REQUEST_SUBJECT, bookingRequestBody, dayWithYear } from "@/lib/bed-planner";
import { AGE_GROUPS } from "@/lib/lodge-search";
import { GET } from "@/app/book/email/[lodgeId]/route";

const groups = (counts: Record<string, number>) =>
  [...AGE_GROUPS].reverse().map((g) => ({ ...g, count: counts[g.key] ?? 0 }));

describe("the message", () => {
  it("has the owner's subject", () => {
    expect(BOOKING_REQUEST_SUBJECT).toBe("Booking request from Alpine Booking Server");
  });

  it("names the group by age tier, adults first, and the stay, then lines to fill in", () => {
    const body = bookingRequestBody(groups({ adults: 2, age5to11: 2, under5: 1 }), "2026-12-18", "2026-12-21");
    expect(body.split("\r\n")).toEqual([
      "Please advise if a booking can be made for 2 adults, 2 children and 1 infant for the period 18 Dec 2026 to 21 Dec 2026.",
      "",
      "Please respond to me at:",
      "Name: ",
      "Email: ",
      "Phone: ",
    ]);
  });

  it("reads naturally for one group", () => {
    const body = bookingRequestBody(groups({ adults: 1 }), "2027-01-02", "2027-01-04");
    expect(body.split("\r\n")[0]).toBe("Please advise if a booking can be made for 1 adult for the period 2 Jan 2027 to 4 Jan 2027.");
    expect(dayWithYear("2026-12-18")).toBe("18 Dec 2026");
  });
});

describe("GET /book/email/:lodgeId", () => {
  const call = (id: string, ip = "203.0.113.5") =>
    GET(new Request(`https://central.example/book/email/${id}`, { headers: { "x-forwarded-for": ip } }), {
      params: Promise.resolve({ lodgeId: id }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true });
  });

  it("gives the email of a live lodge with no booking page, uncached, rate-limited per caller", async () => {
    mocks.findFirst.mockResolvedValue({ siteUrl: null, bookingOfficerEmail: " bookings@club.example " });
    const res = await call("lodge1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ email: "bookings@club.example" });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("book:email:203.0.113.5", expect.any(Number), 10);
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "lodge1", deletedAt: null });
  });

  it.each([
    ["a lodge with a booking page (booked there instead)", { siteUrl: "https://club.example/book", bookingOfficerEmail: "b@club.example" }],
    ["a lodge with no email", { siteUrl: null, bookingOfficerEmail: null }],
    ["a lodge with a blank email", { siteUrl: "", bookingOfficerEmail: "  " }],
    ["an unknown or deleted lodge", null],
  ])("is the same 404 for %s", async (_label, lodge) => {
    mocks.findFirst.mockResolvedValue(lodge);
    const res = await call("lodge1");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No email for this lodge" });
  });

  it("asks nothing for an id that is not a lodge id, or when over the limit", async () => {
    expect((await call("../etc")).status).toBe(404);
    mocks.checkRateLimit.mockReturnValue({ allowed: false });
    expect((await call("lodge1")).status).toBe(429);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
