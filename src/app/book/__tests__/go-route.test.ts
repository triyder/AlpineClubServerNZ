import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  // `findFirst` (#16): the lodge must also not be deleted.
  prisma: { otherLodge: { findFirst: (...a: unknown[]) => findUnique(...a) } },
}));

import { GET } from "@/app/book/go/[lodgeId]/route";

const call = (id: string) =>
  GET(new Request(`https://hub.example/book/go/${id}`), {
    params: Promise.resolve({ lodgeId: id }),
  });

beforeEach(() => {
  findUnique.mockReset();
});

describe("GET /book/go/:lodgeId (Book now)", () => {
  it("redirects (303) to the lodge's stored booking page", async () => {
    findUnique.mockResolvedValue({ siteUrl: "https://ruapehu.example/book?x=1" });
    const res = await call("clx123abc");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://ruapehu.example/book?x=1");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "clx123abc", deletedAt: null },
      select: { siteUrl: true },
    });
  });

  it.each([
    ["an unknown lodge", null],
    ["a lodge with no booking page", { siteUrl: null }],
    ["a stored URL that fails the safety rule", { siteUrl: "javascript:alert(1)" }],
    ["a stored URL naming a user", { siteUrl: "https://club.nz@evil.example" }],
  ])("returns to the search with a message for %s", async (_label, row) => {
    findUnique.mockResolvedValue(row);
    const res = await call("clx123abc");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://hub.example/book?unavailable=1");
  });

  it("does not query for an id that is not a lodge id", async () => {
    const res = await call("..%2Fadmin");
    expect(res.headers.get("location")).toBe("https://hub.example/book?unavailable=1");
    expect(findUnique).not.toHaveBeenCalled();
  });
});
