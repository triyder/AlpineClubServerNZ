import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every state-changing admin API handler is behind `guardAdminWrite` (#13).
 *
 * The write handlers are found from what each `src/app/api/admin/**\/route.ts`
 * module EXPORTS (so `export const POST = …` or a re-export counts too), and
 * the source scan must find the same set. Each must call `guardAdminWrite(req,`
 * as its first statement, at the level the table below pins. Then every one is
 * CALLED: cross-origin it answers 403, with no session 401, and without its
 * role 403 — each before reading its body or touching the database.
 */

const ADMIN_DIR = path.join(process.cwd(), "src/app/api/admin");
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof WRITE)[number];

/**
 * The level each write handler admits. A new handler must be added here, so a
 * moderation route cannot drift from ADMIN to MANAGER unnoticed.
 */
const LEVELS: Record<string, "manager" | "admin"> = {
  "PUT clubs/[id]/lodges": "manager",
  "POST clubs/[id]/tokens": "manager",
  "PATCH images/[id]": "manager",
  "DELETE images/[id]": "manager",
  "POST images": "manager",
  "PATCH other-lodges/[id]": "manager",
  "DELETE other-lodges/[id]": "manager",
  "POST other-lodges": "manager",
  "POST posts/[id]/dismiss": "admin",
  "DELETE posts/[id]/images/[imageId]": "admin",
  "PATCH posts/[id]": "admin",
  "DELETE posts/[id]": "admin",
  "POST posts/[id]/unhide": "admin",
  "POST settings/cleanup": "admin",
  "PUT settings": "admin",
};

/** The only handler that takes a multipart body (the image upload). */
const MULTIPART = new Set(["POST images"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__") return [];
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

type Handler = { key: string; file: string; method: Method; source: string };

const handlers: Handler[] = routeFiles(ADMIN_DIR).flatMap((file) => {
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const route = path.relative(ADMIN_DIR, path.dirname(file)).replace(/\\/g, "/");
  return WRITE.filter((method) => new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source)).map(
    (method) => ({ key: `${method} ${route}`, file, method, source }),
  );
});

/** The handler's first statement: the line after the parameter list's `{`. */
function firstStatement(h: Handler): string {
  const at = h.source.search(new RegExp(`export\\s+async\\s+function\\s+${h.method}\\b`));
  const body = h.source.slice(at).match(/\)\s*(?::\s*[^{]+)?\{\n([\s\S]*)/);
  const lines = (body?.[1] ?? "").split("\n").map((l) => l.trim());
  return lines.find((l) => l !== "" && !l.startsWith("//")) ?? "";
}

// Past the guard, every one of these throws: a handler that read its body or
// the database first fails loudly rather than answering by accident.
const getSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => getSession() }));
vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error("the database was touched before the guard");
      },
    },
  ),
}));

async function load(h: Handler) {
  return (await import(h.file)) as Record<string, unknown>;
}

describe("admin write handlers census (#13)", () => {
  it("finds every write handler, and exactly the ones the level table names", () => {
    expect(handlers.map((h) => h.key).sort()).toEqual(Object.keys(LEVELS).sort());
  });

  it("the source scan and the modules' exports agree on which writes exist", async () => {
    for (const file of new Set(handlers.map((h) => h.file).concat(routeFiles(ADMIN_DIR)))) {
      const exported = Object.keys(await import(file)).filter((k) => (WRITE as readonly string[]).includes(k));
      const scanned = handlers.filter((h) => h.file === file).map((h) => h.method);
      expect(exported.sort(), file).toEqual(scanned.sort());
    }
  });

  it.each(handlers.map((h) => [h.key, h] as const))("%s calls guardAdminWrite first, at its level", (_k, h) => {
    const level = LEVELS[h.key];
    const options = MULTIPART.has(h.key) ? `, \\{ body: "multipart" \\}` : "";
    expect(firstStatement(h)).toMatch(new RegExp(`^const guard = await guardAdminWrite\\(req, "${level}"${options}\\);$`));
  });
});

/** A request with a JSON body; `bodyUsed` says afterwards whether it was read. */
function request(method: Method, headers: Record<string, string>) {
  const req = new Request("https://central.test/api/admin/x", {
    method,
    headers: { host: "central.test", "x-forwarded-proto": "https", "content-type": "application/json", ...headers },
    body: "{}",
  });
  return { req, state: { get read() { return req.bodyUsed; } } };
}

const params = { params: Promise.resolve(new Proxy({}, { get: () => "x" })) };
const SAME_ORIGIN = { origin: "https://central.test", "sec-fetch-site": "same-origin" };

describe("every admin write handler is refused before its body or the database (#13)", () => {
  beforeEach(() => {
    getSession.mockReset().mockResolvedValue({ userId: "u1", email: "a@x.nz", role: "ADMIN" });
  });

  it.each(handlers.map((h) => [h.key, h] as const))("%s: 403 cross-origin, 401 with no session, 403 without its role", async (_k, h) => {
    const handler = (await load(h))[h.method] as (req: Request, ctx: unknown) => Promise<Response>;

    const cross = request(h.method, { origin: "https://evil.test" });
    expect((await handler(cross.req, params)).status).toBe(403);
    expect(cross.state.read).toBe(false);
    expect(getSession).not.toHaveBeenCalled();

    getSession.mockResolvedValue(null);
    const anonymous = request(h.method, SAME_ORIGIN);
    expect((await handler(anonymous.req, params)).status).toBe(401);
    expect(anonymous.state.read).toBe(false);

    // ADMIN-only routes refuse a MANAGER; manager routes refuse a plain USER.
    getSession.mockResolvedValue({ userId: "u1", email: "a@x.nz", role: LEVELS[h.key] === "admin" ? "MANAGER" : "USER" });
    const lacking = request(h.method, SAME_ORIGIN);
    expect((await handler(lacking.req, params)).status).toBe(403);
    expect(lacking.state.read).toBe(false);
  });
});
