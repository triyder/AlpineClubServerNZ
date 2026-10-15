import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => getSession() }));

import { guardAdminSession, guardAdminWrite } from "@/lib/admin-guard";

const ADMIN = { userId: "u1", email: "a@x.nz", role: "ADMIN" as const };
const MANAGER = { ...ADMIN, role: "MANAGER" as const };
const USER = { ...ADMIN, role: "USER" as const };

/** A write to this server, reached as https://central.test behind the proxy. */
function req(headers: Record<string, string> = {}) {
  return new Request("http://internal:3000/api/admin/x", {
    method: "POST",
    headers: { host: "internal:3000", "x-forwarded-host": "central.test", "x-forwarded-proto": "https", ...headers },
  });
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(ADMIN);
  delete process.env.PUBLIC_BASE_URL;
});

describe("guardAdminWrite (#13)", () => {
  it("admits a same-origin browser request, and returns the session", async () => {
    const out = await guardAdminWrite(
      req({ origin: "https://central.test", "sec-fetch-site": "same-origin", "content-type": "application/json" }),
      "manager",
    );
    expect(out).toEqual({ ok: true, session: ADMIN });
  });

  it("admits a request with neither Origin nor Sec-Fetch-Site (not a browser), and none with no body type", async () => {
    expect((await guardAdminWrite(req(), "manager")).ok).toBe(true);
  });

  it("admits `application/json` with a charset", async () => {
    expect((await guardAdminWrite(req({ "content-type": "application/json; charset=utf-8" }), "admin")).ok).toBe(true);
  });

  it.each([
    ["another site's origin", { origin: "https://evil.test" }],
    ["a sibling subdomain (same site, other origin)", { origin: "https://evil.central.test" }],
    ["the same host on another scheme", { origin: "http://central.test" }],
    ["the same host on another port", { origin: "https://central.test:8443" }],
    ["an opaque origin", { origin: "null" }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }],
    ["a matching Origin but Sec-Fetch-Site cross-site", { origin: "https://central.test", "sec-fetch-site": "cross-site" }],
  ])("refuses %s with 403 before looking at the session", async (_label, headers) => {
    const out = await guardAdminWrite(req(headers), "manager");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.response.status).toBe(403);
    expect(await out.response.json()).toMatchObject({ code: "CROSS_ORIGIN" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("uses PUBLIC_BASE_URL as this server's origin when it is set", async () => {
    process.env.PUBLIC_BASE_URL = "https://console.club.test/";
    expect((await guardAdminWrite(req({ origin: "https://console.club.test" }), "manager")).ok).toBe(true);
    expect((await guardAdminWrite(req({ origin: "https://central.test" }), "manager")).ok).toBe(false);
  });

  it.each([
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonp",
  ])("refuses a JSON route's body sent as %s with 415", async (contentType) => {
    const out = await guardAdminWrite(req({ "content-type": contentType }), "manager");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.response.status).toBe(415);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("lets a multipart route take a multipart body, still behind the origin check", async () => {
    const multipart = { "content-type": "multipart/form-data; boundary=x" };
    expect((await guardAdminWrite(req(multipart), "manager", { body: "multipart" })).ok).toBe(true);
    const cross = await guardAdminWrite(req({ ...multipart, origin: "https://evil.test" }), "manager", { body: "multipart" });
    expect(cross.ok).toBe(false);
  });

  it("answers 401 with no session and 403 for a signed-in user without the role", async () => {
    getSession.mockResolvedValue(null);
    const none = await guardAdminWrite(req(), "manager");
    expect(!none.ok && none.response.status).toBe(401);

    getSession.mockResolvedValue(USER);
    const user = await guardAdminWrite(req(), "manager");
    expect(!user.ok && user.response.status).toBe(403);

    getSession.mockResolvedValue(MANAGER);
    expect((await guardAdminWrite(req(), "manager")).ok).toBe(true);
    const managerOnAdmin = await guardAdminWrite(req(), "admin");
    expect(!managerOnAdmin.ok && managerOnAdmin.response.status).toBe(403);
  });
});

describe("guardAdminSession (#13)", () => {
  it("is 401 without a session, 403 without the role, and admits the role", async () => {
    getSession.mockResolvedValue(null);
    const none = await guardAdminSession("admin");
    expect(!none.ok && none.response.status).toBe(401);
    getSession.mockResolvedValue(USER);
    const user = await guardAdminSession("manager");
    expect(!user.ok && user.response.status).toBe(403);
    getSession.mockResolvedValue(ADMIN);
    expect(await guardAdminSession("admin")).toEqual({ ok: true, session: ADMIN });
  });
});
