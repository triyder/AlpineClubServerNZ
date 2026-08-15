import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    club: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

import { registerClub } from "@/lib/clubs";

const input = {
  name: "Ruapehu Lodge",
  code: "RUAPEHU",
  location: "Mt Ruapehu",
  contactEmail: "Contact@Ruapehu.NZ",
};

describe("registerClub", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it("creates a new PENDING club when the code is free", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c1", code: "RUAPEHU", status: "PENDING" });

    const res = await registerClub(input);
    expect(res).toMatchObject({ ok: true, created: true });

    // Contact email is normalised to lowercase before persistence.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: "RUAPEHU",
          contactEmail: "contact@ruapehu.nz",
          status: "PENDING",
        }),
      }),
    );
  });

  it("is idempotent: returns the existing club without recreating it", async () => {
    findUnique.mockResolvedValue({
      id: "c1",
      code: "RUAPEHU",
      status: "APPROVED",
    });

    const res = await registerClub(input);
    expect(res).toMatchObject({ ok: true, created: false });
    if (res.ok) expect(res.club.status).toBe("APPROVED");
    expect(create).not.toHaveBeenCalled();
  });
});
