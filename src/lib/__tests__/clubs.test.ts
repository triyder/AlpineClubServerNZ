import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const lodgeFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    club: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
    },
    otherLodge: { findMany: (...a: unknown[]) => lodgeFindMany(...a) },
  },
}));

import { registerClub } from "@/lib/clubs";

const input = {
  name: "Ruapehu Lodge",
  code: "RUAPEHU",
  location: "Mt Ruapehu",
  contactEmail: "Contact@Ruapehu.NZ",
  lodgeIds: [] as string[],
};

describe("registerClub", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
    lodgeFindMany.mockReset();
    lodgeFindMany.mockResolvedValue([]);
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

  it("stores the requested lodges that are live and free, drops the rest, and keeps the note (#40)", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c1", code: "RUAPEHU", status: "PENDING" });
    lodgeFindMany.mockResolvedValue([{ id: "lodge-a" }]);

    await registerClub({
      ...input,
      lodgeIds: ["lodge-a", "lodge-owned", "lodge-a"],
      notes: "  We are Tukino Lodge, not listed yet.  ",
    });

    // Only lodges that exist, are live and are unowned are asked for.
    expect(lodgeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["lodge-a", "lodge-owned"] }, sourceClubId: null }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedLodgeIds: ["lodge-a"],
          registrationNotes: "We are Tukino Lodge, not listed yet.",
        }),
      }),
    );
  });

  it("asks for no lodge, and looks none up, when none was chosen", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "c1", code: "RUAPEHU", status: "PENDING" });
    await registerClub(input);
    expect(lodgeFindMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestedLodgeIds: [], registrationNotes: null }),
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
