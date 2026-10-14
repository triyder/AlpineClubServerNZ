import { describe, expect, it } from "vitest";
import { buildOtherLodgePullEnvelope, otherLodgePullCursor } from "@/lib/other-lodges";

describe("otherLodgePullCursor (#16)", () => {
  it("is null when the pull returned nothing", () => {
    expect(otherLodgePullCursor([], [])).toBeNull();
  });

  it("is the newest instant across lodges AND deletions", () => {
    expect(
      otherLodgePullCursor(
        [{ updatedAt: "2026-02-01T00:00:00.000Z" }, { updatedAt: "2026-01-01T00:00:00.000Z" }],
        [{ deletedAt: new Date("2026-03-01T00:00:00.000Z") }],
      ),
    ).toBe("2026-03-01T00:00:00.000Z");
    expect(
      otherLodgePullCursor(
        [{ updatedAt: "2026-04-01T00:00:00.000Z" }],
        [{ deletedAt: new Date("2026-03-01T00:00:00.000Z") }],
      ),
    ).toBe("2026-04-01T00:00:00.000Z");
  });

  it("moves past a pull that carried only deletions", () => {
    expect(otherLodgePullCursor([], [{ deletedAt: new Date("2026-03-01T00:00:00.000Z") }])).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
});

describe("buildOtherLodgePullEnvelope deletions (#16)", () => {
  it("sends each deletion as its id and an ISO deletedAt, in the order given", () => {
    const envelope = buildOtherLodgePullEnvelope({
      lodges: [],
      cursor: null,
      ownLodges: [],
      deletedLodges: [
        { id: "a", deletedAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: "b", deletedAt: new Date("2026-02-01T00:00:00.000Z") },
      ],
    });
    expect(envelope.deletedLodges).toEqual([
      { id: "a", deletedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", deletedAt: "2026-02-01T00:00:00.000Z" },
    ]);
  });
});
