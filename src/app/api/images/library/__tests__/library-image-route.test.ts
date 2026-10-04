import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// UPLOADS_DIR is read at call time; set it before the route is imported.
const tempRoot = await mkdtemp(path.join(tmpdir(), "acs-libserve-"));
process.env.UPLOADS_DIR = tempRoot;

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { image: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

const { GET } = await import("@/app/api/images/library/[publicId]/route");

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

const PUBLIC_ID = "ab".repeat(16);
const KEY = "library/2026/10/file.webp";
const BYTES = Buffer.from("RIFF\0\0\0\0WEBPfake");

const call = (publicId: string) =>
  GET(new Request("https://s/api/images/library/x"), {
    params: Promise.resolve({ publicId }),
  });

beforeEach(async () => {
  findUnique.mockReset();
  await mkdir(path.join(tempRoot, "library/2026/10"), { recursive: true });
  await writeFile(path.join(tempRoot, KEY), BYTES);
});

describe("GET /api/images/library/:publicId", () => {
  it.each([
    ["too short", "abc"],
    ["not hex", "z".repeat(32)],
    ["a traversal attempt", "../../etc/passwd"],
    ["upper case", "AB".repeat(16)],
    ["empty", ""],
  ])("404 without touching the database for an id that is %s", async (_label, id) => {
    const res = await call(id);
    expect(res.status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("404 for an id with no row", async () => {
    findUnique.mockResolvedValue(null);
    expect((await call(PUBLIC_ID)).status).toBe(404);
  });

  it("404 (not a crash) when the row exists but its file is gone", async () => {
    findUnique.mockResolvedValue({ storageKey: "library/2026/10/missing.webp" });
    expect((await call(PUBLIC_ID)).status).toBe(404);
  });

  it("serves the bytes with the capability-URL cache and privacy headers", async () => {
    findUnique.mockResolvedValue({ storageKey: KEY });
    const res = await call(`${PUBLIC_ID}.webp`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // The extension is cosmetic: lookup is by the bare id.
    expect(findUnique.mock.calls[0][0].where).toEqual({ publicId: PUBLIC_ID });
  });

  it("refuses a stored key that escapes the uploads root", async () => {
    findUnique.mockResolvedValue({ storageKey: "../outside.webp" });
    await expect(call(PUBLIC_ID)).rejects.toThrow(/outside uploads/);
  });
});
