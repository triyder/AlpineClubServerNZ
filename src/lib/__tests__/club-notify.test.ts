import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  club: { findUnique: vi.fn() },
  otherLodge: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const loadMailSettings = vi.fn();
const sendMail = vi.fn();
vi.mock("@/lib/mail", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  loadMailSettings: (...a: unknown[]) => loadMailSettings(...a),
  sendMail: (...a: unknown[]) => sendMail(...a),
}));
const recordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

import { composeNewClubMail, notifyNewClub } from "@/lib/club-notify";

const MAIL = {
  host: "smtp.example.net",
  port: 587,
  security: "starttls",
  user: "u",
  passwordSet: true,
  fromAddress: "server@example.nz",
  fromName: "",
  digestTo: "",
};

const CLUB = {
  id: "cl_1",
  name: "Ruapehu Lodge",
  code: "RUAPEHU",
  location: "Whakapapa",
  contactEmail: "contact@ruapehu.nz",
  createdAt: new Date("2026-10-30T01:02:00.000Z"),
  registrationNotes: "We run two huts.\nCall Sam.",
  requestedLodgeIds: ["lodge-a"],
};

describe("the new-club mail", () => {
  const savedBase = process.env.PUBLIC_BASE_URL;
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
    loadMailSettings.mockReset().mockResolvedValue(MAIL);
    sendMail.mockReset().mockResolvedValue({ messageId: "<m1>" });
    recordAudit.mockReset();
    db.club.findUnique.mockResolvedValue(CLUB);
    db.otherLodge.findMany.mockResolvedValue([{ name: "Ruapehu Hut" }]);
    db.user.findMany.mockResolvedValue([{ email: "admin@example.nz" }]);
    process.env.PUBLIC_BASE_URL = "https://alpine-server.example.nz/";
  });
  afterEach(() => {
    if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = savedBase;
  });

  it("tells every admin, with the club's details and a review link on PUBLIC_BASE_URL", async () => {
    const result = await notifyNewClub("cl_1", "web");

    expect(result).toEqual({ sent: true, to: ["admin@example.nz"] });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe("admin@example.nz");
    expect(mail.subject).toBe("New club connection awaiting approval: Ruapehu Lodge");
    expect(mail.text).toContain("Code: RUAPEHU");
    expect(mail.text).toContain("Contact email: contact@ruapehu.nz");
    expect(mail.text).toContain("Lodges requested: Ruapehu Hut");
    expect(mail.text).toContain("  Call Sam.");
    expect(mail.text).toContain("https://alpine-server.example.nz/clubs/review/cl_1");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "club.notify", clubId: "cl_1" }));
  });

  it("prefers the digest address under Settings → Email", async () => {
    loadMailSettings.mockResolvedValue({ ...MAIL, digestTo: "ops@example.nz" });
    await notifyNewClub("cl_1", "api");
    expect(sendMail.mock.calls[0][0].to).toBe("ops@example.nz");
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("leaves the link out without PUBLIC_BASE_URL, rather than trusting the registrant's Host header", async () => {
    delete process.env.PUBLIC_BASE_URL;
    await notifyNewClub("cl_1", "api");
    const mail = sendMail.mock.calls[0][0];
    expect(mail.text).not.toContain("/clubs/review/");
    expect(mail.text).toContain("Connections page (/clubs)");
  });

  it("never throws: no SMTP server, no recipient, or a refused send is reported, not raised", async () => {
    loadMailSettings.mockResolvedValue({ ...MAIL, host: "" });
    expect(await notifyNewClub("cl_1", "web")).toEqual({ sent: false, reason: "not-configured" });

    loadMailSettings.mockResolvedValue(MAIL);
    db.user.findMany.mockResolvedValue([]);
    expect(await notifyNewClub("cl_1", "web")).toEqual({ sent: false, reason: "no-recipient" });

    db.user.findMany.mockResolvedValue([{ email: "admin@example.nz" }]);
    sendMail.mockRejectedValue(new Error("550 relay denied"));
    expect(await notifyNewClub("cl_1", "web")).toEqual({ sent: false, reason: "failed" });

    db.club.findUnique.mockResolvedValue(null);
    expect(await notifyNewClub("cl_x", "web")).toEqual({ sent: false, reason: "missing" });
  });

  it("keeps what the registrant typed on one line each, and escapes it in the HTML", () => {
    const mail = composeNewClubMail(
      { ...CLUB, name: "Evil <b>Club</b>\r\nBcc: x@y.z" },
      ["<img src=x>"],
      "web",
      null,
    );
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain("Club: Evil <b>Club</b>Bcc: x@y.z");
    expect(mail.html).toContain("Evil &lt;b&gt;Club&lt;/b&gt;");
    expect(mail.html).toContain("&lt;img src=x&gt;");
    expect(mail.html).not.toContain("<img");
  });
});
