import { describe, it, expect, vi, beforeEach } from "vitest";

const requireManager = vi.fn();
vi.mock("@/lib/admin-guard", () => ({
  requireManager: () => requireManager(),
}));

const calls: string[] = [];

const findMany = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const del = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/db", () => ({
  prisma: {
    image: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => {
        calls.push("row");
        return del(...a);
      },
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

const write = vi.fn();
const removeFile = vi.fn();
vi.mock("@/lib/uploads", async (orig) => {
  const actual = await orig<typeof import("@/lib/uploads")>();
  return {
    ...actual,
    writeProcessedImage: (...a: unknown[]) => write(...a),
    deleteStoredImage: (...a: unknown[]) => {
      calls.push("file");
      return removeFile(...a);
    },
  };
});

import { GET, POST } from "@/app/api/admin/images/route";
import { PATCH, DELETE } from "@/app/api/admin/images/[id]/route";
import { ImageRejectedError } from "@/lib/uploads";

const SESSION = { userId: "u1", email: "a@x.nz", role: "ADMIN" as const };
const at = new Date("2026-03-01T10:00:00.000Z");

const row = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  kind: "IMAGE",
  name: "Hut",
  publicId: "a".repeat(32),
  storageKey: "library/2026/03/x.webp",
  width: 800,
  height: 600,
  bytes: 5000,
  createdAt: at,
  lodgesUsingAsImage: [] as Array<{ name: string }>,
  lodgesUsingAsLogo: [] as Array<{ name: string }>,
  ...over,
});

const stored = {
  storageKey: "library/2026/03/x.webp",
  publicId: "a".repeat(32),
  width: 800,
  height: 600,
  bytes: 5000,
};

function pngFile(name = "My Lodge.png", size = 10) {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function uploadReq(fields: Record<string, string | File | File[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const f of v) form.append(k, f);
    else form.append(k, v);
  }
  return new Request("https://s/api/admin/images", { method: "POST", body: form });
}

const jsonReq = (method: string, body: unknown) =>
  new Request("https://s/api/admin/images/i1", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id = "i1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  calls.length = 0;
  requireManager.mockReset().mockResolvedValue(SESSION);
  findMany.mockReset().mockResolvedValue([]);
  findUnique.mockReset();
  create.mockReset().mockImplementation(async () => row());
  update.mockReset();
  del.mockReset().mockResolvedValue({});
  write.mockReset().mockResolvedValue(stored);
  removeFile.mockReset().mockResolvedValue(true);
  auditCreate.mockClear();
});

describe("GET /api/admin/images", () => {
  it("401 for a caller who is not a manager", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    const res = await GET(new Request("https://s/api/admin/images"));
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("400 for an unknown kind", async () => {
    const res = await GET(new Request("https://s/api/admin/images?kind=ICON"));
    expect(res.status).toBe(400);
  });

  it("filters by kind and serialises with the public URL and the using lodges", async () => {
    findMany.mockResolvedValue([row({ lodgesUsingAsImage: [{ name: "Ruapehu" }] })]);
    const res = await GET(new Request("https://s/api/admin/images?kind=IMAGE"));
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].where).toEqual({ kind: "IMAGE" });
    const [image] = (await res.json()).images;
    expect(image).toMatchObject({
      id: "i1",
      url: `/api/images/library/${"a".repeat(32)}.webp`,
      usedBy: ["Ruapehu"],
    });
    expect(image).not.toHaveProperty("storageKey");
  });

  it("returns everything when no kind is given", async () => {
    await GET(new Request("https://s/api/admin/images"));
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });
});

describe("POST /api/admin/images", () => {
  it("401 for a caller who is not a manager, and stores nothing", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    const res = await POST(uploadReq({ kind: "IMAGE", files: [pngFile()] }));
    expect(res.status).toBe(401);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["no kind", { files: [pngFile()] }],
    ["an unknown kind", { kind: "ICON", files: [pngFile()] }],
  ])("400 for %s", async (_label, fields) => {
    const res = await POST(uploadReq(fields as Record<string, string | File[]>));
    expect(res.status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it("400 when there are no files", async () => {
    const res = await POST(uploadReq({ kind: "IMAGE" }));
    expect(res.status).toBe(400);
  });

  it("413 for more than ten files, before anything is decoded", async () => {
    const files = Array.from({ length: 11 }, (_, i) => pngFile(`f${i}.png`));
    const res = await POST(uploadReq({ kind: "IMAGE", files }));
    expect(res.status).toBe(413);
    expect(write).not.toHaveBeenCalled();
  });

  it("413 when the files total more than the combined budget", async () => {
    const big = pngFile("big.png", 9 * 1024 * 1024 + 1);
    const res = await POST(uploadReq({ kind: "IMAGE", files: [big] }));
    expect(res.status).toBe(413);
    expect(write).not.toHaveBeenCalled();
  });

  it("stores a lodge image with the library image profile and records who uploaded it", async () => {
    const res = await POST(uploadReq({ kind: "IMAGE", files: [pngFile("My Lodge.png")] }));
    expect(res.status).toBe(201);
    expect(write.mock.calls[0][2]).toMatchObject({ folder: "library", maxWidth: 1920, maxHeight: 1080 });
    expect(create.mock.calls[0][0].data).toMatchObject({
      kind: "IMAGE",
      name: "My Lodge",
      publicId: stored.publicId,
      storageKey: stored.storageKey,
      width: 800,
      height: 600,
      bytes: 5000,
      uploadedById: "u1",
    });
    expect((await res.json()).images).toHaveLength(1);
  });

  it("stores a logo with the smaller logo profile", async () => {
    await POST(uploadReq({ kind: "LOGO", files: [pngFile("club.png")] }));
    expect(write.mock.calls[0][2]).toMatchObject({ folder: "library", maxWidth: 600, maxHeight: 600 });
    expect(create.mock.calls[0][0].data.kind).toBe("LOGO");
  });

  it("reports a file that is not an image, writes no row for it, and 400s when nothing was stored", async () => {
    write.mockRejectedValue(new ImageRejectedError("File is not a JPEG, PNG or WebP image"));
    const res = await POST(uploadReq({ kind: "IMAGE", files: [pngFile("evil.php.png")] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.images).toEqual([]);
    expect(body.rejected).toEqual([
      { filename: "evil.php.png", error: "File is not a JPEG, PNG or WebP image" },
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it("a bad file does not lose the rest of the batch", async () => {
    write
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(new ImageRejectedError("bad"));
    const res = await POST(
      uploadReq({ kind: "IMAGE", files: [pngFile("good.png"), pngFile("bad.png")] }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.images).toHaveLength(1);
    expect(body.rejected).toHaveLength(1);
  });

  it("removes the stored file when its row cannot be written (no orphan)", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(
      POST(uploadReq({ kind: "IMAGE", files: [pngFile()] })),
    ).rejects.toThrow("db down");
    expect(removeFile).toHaveBeenCalledWith(stored.storageKey);
  });

  it("audits the upload with counts only", async () => {
    await POST(uploadReq({ kind: "IMAGE", files: [pngFile()] }));
    const audit = auditCreate.mock.calls[0][0].data;
    expect(audit.action).toBe("image.upload");
    expect(audit.userId).toBe("u1");
    expect(audit.metadata).toEqual({ kind: "IMAGE", uploaded: 1, rejected: 0 });
  });
});

describe("PATCH /api/admin/images/:id", () => {
  it("401 for a caller who is not a manager", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    const res = await PATCH(jsonReq("PATCH", { name: "x" }), ctx());
    expect(res.status).toBe(401);
  });

  it("400 for a blank name and for trying to change the type", async () => {
    expect((await PATCH(jsonReq("PATCH", { name: "  " }), ctx())).status).toBe(400);
    expect((await PATCH(jsonReq("PATCH", { name: "x", kind: "LOGO" }), ctx())).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("404 for an unknown picture", async () => {
    findUnique.mockResolvedValue(null);
    expect((await PATCH(jsonReq("PATCH", { name: "x" }), ctx("nope"))).status).toBe(404);
  });

  it("renames, trimming the name", async () => {
    findUnique.mockResolvedValue({ id: "i1" });
    update.mockResolvedValue(row({ name: "New name" }));
    const res = await PATCH(jsonReq("PATCH", { name: "  New name  " }), ctx());
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toEqual({ name: "New name" });
    expect((await res.json()).image.name).toBe("New name");
  });
});

describe("DELETE /api/admin/images/:id", () => {
  it("401 for a caller who is not a manager", async () => {
    requireManager.mockRejectedValue(new Error("Not authorized"));
    expect((await DELETE(new Request("https://s/x"), ctx())).status).toBe(401);
    expect(del).not.toHaveBeenCalled();
  });

  it("404 for an unknown picture", async () => {
    findUnique.mockResolvedValue(null);
    expect((await DELETE(new Request("https://s/x"), ctx("nope"))).status).toBe(404);
  });

  it("409 naming the lodges while a picture is in use, deleting neither row nor file", async () => {
    findUnique.mockResolvedValue(
      row({
        lodgesUsingAsImage: [{ name: "Ruapehu Lodge" }],
        lodgesUsingAsLogo: [{ name: "Tasman Lodge" }],
      }),
    );
    const res = await DELETE(new Request("https://s/x"), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.lodges).toEqual(["Ruapehu Lodge", "Tasman Lodge"]);
    expect(body.error).toContain("Ruapehu Lodge");
    expect(del).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("deletes the ROW first and the file second", async () => {
    findUnique.mockResolvedValue(row());
    const res = await DELETE(new Request("https://s/x"), ctx());
    expect(res.status).toBe(200);
    expect(calls).toEqual(["row", "file"]);
    expect(removeFile).toHaveBeenCalledWith("library/2026/03/x.webp");
    expect(auditCreate.mock.calls[0][0].data.action).toBe("image.delete");
  });

  it("still succeeds when the file cannot be removed (an orphan file is harmless)", async () => {
    findUnique.mockResolvedValue(row());
    removeFile.mockRejectedValue(new Error("EBUSY"));
    const res = await DELETE(new Request("https://s/x"), ctx());
    expect(res.status).toBe(200);
  });
});
