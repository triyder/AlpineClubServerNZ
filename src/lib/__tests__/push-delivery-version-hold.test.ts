import { describe, it, expect, vi, beforeEach } from "vitest";

const deliveryFindMany = vi.fn();
const deliveryFindUnique = vi.fn();
const deliveryUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    postDelivery: {
      findMany: (...a: unknown[]) => deliveryFindMany(...a),
      findUnique: (...a: unknown[]) => deliveryFindUnique(...a),
      update: (...a: unknown[]) => deliveryUpdate(...a),
    },
  },
}));

const assertPublicDestination = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/push-targets", async (orig) => {
  const actual = await orig<typeof import("@/lib/push-targets")>();
  return {
    ...actual,
    assertPublicDestination: (...a: unknown[]) => assertPublicDestination(...a),
  };
});

import { runPostDeliverySweep } from "@/lib/push-delivery";
import { SERVER_API_VERSION } from "@/lib/api-version";

const fetchMock = vi.fn();

function row(lastReportedApiVersion: string | null) {
  return {
    id: "d1",
    kind: "CREATED",
    attempts: 0,
    club: {
      id: "club_1",
      pushUrl: "https://club.example/hook",
      pushSecretVersion: 1,
      lastReportedApiVersion,
    },
    post: { id: "p1", removedAt: null, hiddenAt: null },
  };
}

beforeEach(() => {
  process.env.PUSH_SIGNING_KEY = "k".repeat(40);
  deliveryFindMany.mockReset().mockResolvedValue([{ id: "d1" }]);
  deliveryFindUnique.mockReset();
  deliveryUpdate.mockReset().mockResolvedValue({});
  assertPublicDestination.mockClear();
  fetchMock.mockReset().mockResolvedValue(new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("push delivery and the club's reported API version", () => {
  it("HOLDS a delivery for a club reporting a different version: nothing is sent and no attempt is consumed", async () => {
    deliveryFindUnique.mockResolvedValue(row("0.9"));
    const result = await runPostDeliverySweep();

    expect(result).toMatchObject({ attempted: 1, held: 1, delivered: 0, failed: 0, abandoned: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertPublicDestination).not.toHaveBeenCalled();

    const data = deliveryUpdate.mock.calls[0][0].data;
    expect(data.attempts).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.lastError).toContain("0.9");
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("delivers to a club whose reported version matches", async () => {
    deliveryFindUnique.mockResolvedValue(row(SERVER_API_VERSION));
    const result = await runPostDeliverySweep();
    expect(result).toMatchObject({ delivered: 1, held: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not hold a club that has never reported a version (older software)", async () => {
    deliveryFindUnique.mockResolvedValue(row(null));
    const result = await runPostDeliverySweep();
    expect(result).toMatchObject({ delivered: 1, held: 0 });
  });
});
