import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    club: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "@/app/api/v1/clubs/register/route";
import { resetRateLimits } from "@/lib/rate-limit";

function post(body: unknown, ip = "203.0.113.7") {
  return new Request("https://server/api/v1/clubs/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const valid = {
  name: "Ruapehu Lodge",
  code: "RUAPEHU",
  contactEmail: "contact@ruapehu.nz",
};

describe("POST /api/v1/clubs/register", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
    auditCreate.mockClear();
    resetRateLimits();
  });

  it("registers a new club and returns 201", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c1", code: "RUAPEHU", status: "PENDING" });

    const res = await POST(post(valid));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ code: "RUAPEHU", status: "PENDING" });
  });

  it("rejects an invalid payload with 400", async () => {
    const res = await POST(post({ name: "x", code: "!!", contactEmail: "nope" }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 200 (not 201) when the club already exists", async () => {
    findUnique.mockResolvedValue({
      id: "c1",
      code: "RUAPEHU",
      status: "PENDING",
    });
    const res = await POST(post(valid));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });

  it("rate-limits repeated requests from the same IP with 429", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c1", code: "RUAPEHU", status: "PENDING" });

    // Default RATE_LIMIT_MAX is 120; drive one IP past it.
    let last: Response | null = null;
    for (let i = 0; i < 121; i++) {
      last = await POST(post(valid, "198.51.100.1"));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).not.toBeNull();
  });
});
