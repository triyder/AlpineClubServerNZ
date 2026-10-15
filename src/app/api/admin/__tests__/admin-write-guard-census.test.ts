import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every state-changing admin API handler is behind `guardAdminWrite` (#13).
 *
 * The census reads every `src/app/api/admin/**\/route.ts` and finds each
 * exported POST, PUT, PATCH and DELETE; each must call `guardAdminWrite(req,`
 * as its first statement, so a new write route cannot skip the origin check.
 * Then every one of them is CALLED with a cross-origin request and must answer
 * 403 without touching the database or reading its body.
 */

const ADMIN_DIR = path.join(process.cwd(), "src/app/api/admin");
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__") return [];
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

type Handler = { file: string; method: (typeof WRITE)[number]; firstStatement: string };

function writeHandlers(): Handler[] {
  return routeFiles(ADMIN_DIR).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return WRITE.flatMap((method) => {
      const at = source.search(new RegExp(`export async function ${method}\\b`));
      if (at < 0) return [];
      // The body starts after the parameter list's closing `) {` (or `): Promise<…> {`).
      const open = source.indexOf("{\n", source.indexOf(")", at));
      const firstStatement = source.slice(open + 2).trimStart().split("\n")[0] ?? "";
      return [{ file: path.relative(process.cwd(), file).replace(/\\/g, "/"), method, firstStatement }];
    });
  });
}

const handlers = writeHandlers();

describe("admin write handlers census (#13)", () => {
  it("finds the admin write handlers (a broken scan would pass vacuously)", () => {
    expect(handlers.length).toBeGreaterThanOrEqual(15);
  });

  it.each(handlers.map((h) => [`${h.method} ${h.file}`, h] as const))(
    "%s calls guardAdminWrite first",
    (_label, h) => {
      expect(h.firstStatement).toMatch(/^const guard = await guardAdminWrite\(req, "(manager|admin)"/);
    },
  );
});

// Anything past the guard would reach these: each throws, so a handler that
// skipped the guard fails loudly instead of answering 403 by accident.
const getSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => getSession() }));
vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error("the database was touched before the origin check");
      },
    },
  ),
}));

describe("every admin write handler refuses a cross-origin request (#13)", () => {
  beforeAll(() => {
    getSession.mockResolvedValue({ userId: "u1", email: "a@x.nz", role: "ADMIN" });
  });

  it.each(handlers.map((h) => [`${h.method} ${h.file}`, h] as const))("%s answers 403", async (_label, h) => {
    const mod = (await import(path.join(process.cwd(), h.file))) as Record<
      string,
      (req: Request, ctx: unknown) => Promise<Response>
    >;
    const handler = mod[h.method];
    if (!handler) throw new Error(`${h.method} not exported from ${h.file}`);
    const req = new Request("https://central.test/api/admin/x", {
      method: h.method,
      headers: { host: "central.test", origin: "https://evil.test", "content-type": "application/json" },
      body: "{}",
    });
    const params = new Proxy({}, { get: () => "x" });
    const res = await handler(req, { params: Promise.resolve(params) });
    expect(res.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });
});
