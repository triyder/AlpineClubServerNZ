import { describe, it, expect, vi, beforeEach } from "vitest";

// The real admin guard runs (#13); only the session under it is faked.
const getSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: () => getSession(),
}));

const loadMailSettings = vi.fn();
const saveMailSettings = vi.fn();
const sendMail = vi.fn();
const recordAudit = vi.fn();
vi.mock("@/lib/mail", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  loadMailSettings: (...a: unknown[]) => loadMailSettings(...a),
  saveMailSettings: (...a: unknown[]) => saveMailSettings(...a),
  sendMail: (...a: unknown[]) => sendMail(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { GET, PUT } from "@/app/api/admin/settings/email/route";
import { POST as TEST } from "@/app/api/admin/settings/email/test/route";
import { MailNotConfiguredError, MailSettingsError } from "@/lib/mail";

const ADMIN = { userId: "u1", email: "admin@example.nz", role: "ADMIN" as const };
const VIEW = {
  host: "smtp.example.net",
  port: 587,
  security: "starttls",
  user: "u",
  passwordSet: true,
  fromAddress: "server@example.nz",
  fromName: "",
  digestTo: "",
};
const put = (body: unknown) =>
  new Request("https://s/api/admin/settings/email", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const post = () => new Request("https://s/api/admin/settings/email/test", { method: "POST" });

describe("email settings routes (#33)", () => {
  beforeEach(() => {
    getSession.mockReset();
    loadMailSettings.mockReset();
    saveMailSettings.mockReset();
    sendMail.mockReset();
    recordAudit.mockReset();
    getSession.mockResolvedValue(ADMIN);
    loadMailSettings.mockResolvedValue(VIEW);
    saveMailSettings.mockResolvedValue(VIEW);
  });

  it("GET reports whether a password is set and never a password", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.settings.passwordSet).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/password"?:\s*"/);
  });

  it("PUT saves, audits without the password, and answers 409 when the server cannot store one", async () => {
    const res = await PUT(put({ ...VIEW, passwordSet: undefined, password: "hunter2" }));
    expect(res.status).toBe(200);
    expect(saveMailSettings).toHaveBeenCalledWith(expect.objectContaining({ password: "hunter2" }));
    const audit = recordAudit.mock.calls[0][0];
    expect(audit.action).toBe("settings.email.update");
    expect(audit.metadata.passwordReplaced).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("hunter2");

    saveMailSettings.mockRejectedValue(new MailSettingsError("SETTINGS_ENCRYPTION_KEY is not set"));
    const refused = await PUT(put({ ...VIEW, passwordSet: undefined, password: "hunter2" }));
    expect(refused.status).toBe(409);
  });

  it("PUT rejects a malformed body before saving", async () => {
    const res = await PUT(put({ host: "x", port: "eighty" }));
    expect(res.status).toBe(400);
    expect(saveMailSettings).not.toHaveBeenCalled();
  });

  it("the test message goes to the signed-in administrator only, whatever the request says", async () => {
    sendMail.mockResolvedValue({ messageId: "<m1>" });
    const res = await TEST(
      new Request("https://s/api/admin/settings/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "victim@example.org" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, to: "admin@example.nz" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@example.nz" }));
  });

  it("the test message reports the provider's words on failure and 409 when nothing is configured", async () => {
    sendMail.mockRejectedValue(new Error("535 Authentication credentials invalid"));
    const failed = await TEST(post());
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("535 Authentication credentials invalid");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "settings.email.test", outcome: "FAILURE" }),
    );

    sendMail.mockRejectedValue(new MailNotConfiguredError("No SMTP server is configured"));
    const unset = await TEST(post());
    expect(unset.status).toBe(409);
  });

  it("refuses anyone who is not an ADMIN", async () => {
    getSession.mockResolvedValue({ ...ADMIN, role: "MANAGER" });
    expect((await GET()).status).toBe(403);
    expect((await PUT(put(VIEW))).status).toBe(403);
    expect((await TEST(post())).status).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
