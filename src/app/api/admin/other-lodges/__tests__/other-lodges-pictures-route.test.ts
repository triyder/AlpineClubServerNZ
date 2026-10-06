import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const requireManager = vi.fn();
vi.mock("@/lib/admin-guard", () => ({
  requireManager: () => requireManager(),
}));

const create = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
const imageFindMany = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    otherLodge: {
      create: (...a: unknown[]) => create(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      // Every name, read for the lookalike check on create and rename.
      findMany: async () => [],
      update: (...a: unknown[]) => update(...a),
    },
    image: { findMany: (...a: unknown[]) => imageFindMany(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "@/app/api/admin/other-lodges/route";
import { PATCH } from "@/app/api/admin/other-lodges/[id]/route";

const SESSION = { userId: "u1", email: "a@x.nz", role: "ADMIN" as const };

const dbRow = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  name: "Ruapehu Lodge",
  location: null,
  bookingOfficerName: null,
  bookingOfficerEmail: null,
  bookingOfficerPhone: null,
  bedCapacity: null,
  siteUrl: null,
  doubleBeds: null,
  singleBeds: null,
  minutesWalkToLodge: null,
  roomType: null,
  skiWorkshopArea: false,
  gamesRoom: false,
  requiresLodgeCustodian: false,
  freeWifi: false,
  quietRoom: false,
  dryingRoom: false,
  sharedKitchen: false,
  wheelchairAccessible: false,
  breakfastIncluded: false,
  lunchIncluded: false,
  dinnerIncluded: false,
  cancellationPeriod: null,
  winterSeasonStart: null,
  summerSeasonStart: null,
  amenities: [],
  image: null,
  logo: null,
  sourceClubId: null,
  sourceClub: null,
  lastUpdatedByClubId: null,
  lastUpdatedByClub: null,
  lastUploadedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const jsonReq = (method: string, body: unknown) =>
  new Request("https://s/api/admin/other-lodges", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "l1" }) };

beforeEach(() => {
  requireManager.mockReset().mockResolvedValue(SESSION);
  create.mockReset().mockResolvedValue(dbRow());
  findUnique.mockReset().mockResolvedValue(dbRow());
  update.mockReset().mockResolvedValue(dbRow());
  imageFindMany.mockReset().mockResolvedValue([]);
  auditCreate.mockClear();
});

describe("choosing a lodge's picture and logo — create", () => {
  it("connects the chosen library pictures", async () => {
    imageFindMany.mockResolvedValue([
      { id: "img1", kind: "IMAGE" },
      { id: "logo1", kind: "LOGO" },
    ]);
    const res = await POST(
      jsonReq("POST", { name: "Ruapehu Lodge", imageId: "img1", logoId: "logo1" }),
    );
    expect(res.status).toBe(201);
    const data = create.mock.calls[0][0].data;
    expect(data.image).toEqual({ connect: { id: "img1" } });
    expect(data.logo).toEqual({ connect: { id: "logo1" } });
  });

  it("leaves both unset when neither is sent, without querying the library", async () => {
    const res = await POST(jsonReq("POST", { name: "Ruapehu Lodge" }));
    expect(res.status).toBe(201);
    const data = create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("image");
    expect(data).not.toHaveProperty("logo");
    expect(imageFindMany).not.toHaveBeenCalled();
  });

  it("400 for a picture that does not exist, and creates nothing", async () => {
    imageFindMany.mockResolvedValue([]);
    const res = await POST(jsonReq("POST", { name: "X", imageId: "ghost" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer exists/);
    expect(create).not.toHaveBeenCalled();
  });

  it("400 for a logo used as the lodge image", async () => {
    imageFindMany.mockResolvedValue([{ id: "logo1", kind: "LOGO" }]);
    const res = await POST(jsonReq("POST", { name: "X", imageId: "logo1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/logo cannot be used as the lodge image/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("400 for a lodge image used as the logo", async () => {
    imageFindMany.mockResolvedValue([{ id: "img1", kind: "IMAGE" }]);
    const res = await POST(jsonReq("POST", { name: "X", logoId: "img1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/lodge image cannot be used as the logo/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("400, with the same message, when the picture is deleted between the check and the write (P2025)", async () => {
    imageFindMany.mockResolvedValue([{ id: "logo1", kind: "LOGO" }]);
    create.mockRejectedValue(notFound());
    const res = await POST(jsonReq("POST", { name: "X", logoId: "logo1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The chosen lodge logo no longer exists. Choose another.");
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("a P2025 with no picture chosen is not swallowed", async () => {
    create.mockRejectedValue(notFound());
    await expect(POST(jsonReq("POST", { name: "X" }))).rejects.toMatchObject({ code: "P2025" });
  });
});

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError("not found", { code: "P2025", clientVersion: "7" });

describe("choosing a lodge's picture and logo — update", () => {
  it("connects a chosen picture", async () => {
    imageFindMany.mockResolvedValue([{ id: "img1", kind: "IMAGE" }]);
    const res = await PATCH(jsonReq("PATCH", { imageId: "img1" }), ctx);
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({
      image: { connect: { id: "img1" } },
      lastUpdatedByClub: { disconnect: true }, lastUploadedAt: null,
    });
  });

  it("null clears the picture and does not query the library", async () => {
    const res = await PATCH(jsonReq("PATCH", { imageId: null, logoId: null }), ctx);
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({
      image: { disconnect: true },
      logo: { disconnect: true },
      lastUpdatedByClub: { disconnect: true }, lastUploadedAt: null,
    });
    expect(imageFindMany).not.toHaveBeenCalled();
  });

  it("leaves the pictures alone when neither field is sent", async () => {
    await PATCH(jsonReq("PATCH", { bedCapacity: 10 }), ctx);
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("image");
    expect(data).not.toHaveProperty("logo");
  });

  it("400 for a wrong-type picture, and writes nothing", async () => {
    imageFindMany.mockResolvedValue([{ id: "img1", kind: "IMAGE" }]);
    const res = await PATCH(jsonReq("PATCH", { logoId: "img1" }), ctx);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("400, with the same message, when the picture is deleted between the check and the write (P2025)", async () => {
    imageFindMany.mockResolvedValue([{ id: "img1", kind: "IMAGE" }]);
    update.mockRejectedValue(notFound());
    const res = await PATCH(jsonReq("PATCH", { imageId: "img1" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The chosen lodge image no longer exists. Choose another.");
  });

  it("names just 'picture' when both were chosen and one has gone", async () => {
    imageFindMany.mockResolvedValue([
      { id: "img1", kind: "IMAGE" },
      { id: "logo1", kind: "LOGO" },
    ]);
    update.mockRejectedValue(notFound());
    const res = await PATCH(jsonReq("PATCH", { imageId: "img1", logoId: "logo1" }), ctx);
    expect((await res.json()).error).toBe("The chosen picture no longer exists. Choose another.");
  });

  it("returns the chosen picture and logo with their public URLs", async () => {
    imageFindMany.mockResolvedValue([{ id: "img1", kind: "IMAGE" }]);
    update.mockResolvedValue(
      dbRow({ image: { id: "img1", name: "Hut", publicId: "p".repeat(32) } }),
    );
    const res = await PATCH(jsonReq("PATCH", { imageId: "img1" }), ctx);
    const { otherLodge } = await res.json();
    expect(otherLodge.image).toEqual({
      id: "img1",
      name: "Hut",
      url: `/api/images/library/${"p".repeat(32)}.webp`,
    });
    expect(otherLodge.logo).toBeNull();
  });
});
