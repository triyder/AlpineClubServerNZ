import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  club: { findMany: vi.fn() },
  apiToken: { findMany: vi.fn() },
  syncIssue: { findMany: vi.fn(), count: vi.fn() },
  systemSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  user: { findMany: vi.fn() },
  jobClaim: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
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

import { composeDigest, digestIsEmpty, runAdminDigest, type DigestContent } from "@/lib/admin-digest";

const NOW = new Date("2026-10-22T07:15:00.000Z");
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

function nothing() {
  db.club.findMany.mockResolvedValue([]);
  db.apiToken.findMany.mockResolvedValue([]);
  db.syncIssue.findMany.mockResolvedValue([]);
  db.syncIssue.count.mockResolvedValue(0);
}

function something() {
  db.club.findMany
    .mockResolvedValueOnce([
      { name: "Ruapehu Lodge", code: "RUAPEHU", location: "Whakapapa", createdAt: new Date("2026-10-21T20:00:00.000Z") },
    ])
    .mockResolvedValueOnce([]);
  db.apiToken.findMany
    .mockResolvedValueOnce([
      { name: "Default key", tokenPrefix: "acs_0123abcd", createdAt: new Date("2026-10-21T20:00:01.000Z"), club: { name: "Ruapehu Lodge" } },
    ])
    .mockResolvedValueOnce([]);
  db.syncIssue.findMany.mockResolvedValue([
    { kind: "version-mismatch", firstSeenAt: new Date("2026-10-22T01:00:00.000Z"), occurrences: 3, club: { name: "Aorangi" } },
  ]);
  db.syncIssue.count.mockResolvedValue(2);
}

describe("the administrator digest (#34)", () => {
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
    loadMailSettings.mockReset();
    sendMail.mockReset();
    recordAudit.mockReset();
    db.jobClaim.upsert.mockResolvedValue({});
    db.jobClaim.updateMany.mockResolvedValue({ count: 1 });
    db.jobClaim.update.mockResolvedValue({});
    db.systemSetting.upsert.mockResolvedValue({});
    db.systemSetting.findUnique.mockResolvedValue({ key: "digest.last_sent_at", value: "2026-10-21T07:15:00.000Z" });
    db.user.findMany.mockResolvedValue([{ email: "admin@example.nz" }, { email: "second@example.nz" }]);
    loadMailSettings.mockResolvedValue(MAIL);
    sendMail.mockResolvedValue({ messageId: "<m1>" });
  });

  it("sends once with everything since the watermark, then advances the watermark", async () => {
    something();
    const result = await runAdminDigest({ now: NOW, baseUrl: "https://srv.example.nz" });

    expect(result).toMatchObject({
      ran: true,
      sent: true,
      to: ["admin@example.nz", "second@example.nz"],
      counts: { registered: 1, tokensIssued: 1, issuesOpened: 1, issuesStillOpen: 2 },
    });
    // The window is (last watermark, now].
    expect(db.club.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gt: new Date("2026-10-21T07:15:00.000Z"),
      lte: NOW,
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe("admin@example.nz, second@example.nz");
    expect(mail.text).toContain("Ruapehu Lodge (RUAPEHU), Whakapapa");
    expect(mail.text).toContain("Aorangi: version-mismatch");
    expect(mail.text).toContain("https://srv.example.nz/clubs");
    // Only the key's non-secret prefix is named; never a whole key.
    expect(mail.text).toContain("acs_0123abcd…");
    expect(mail.text).not.toMatch(/acs_[0-9a-f]{8}_[0-9a-f]{40}/);
    expect(db.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "digest.last_sent_at" }, update: { value: NOW.toISOString() } }),
    );
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "digest.sent" }));
  });

  it("sends nothing and keeps the watermark when nothing happened", async () => {
    nothing();
    const result = await runAdminDigest({ now: NOW });
    expect(result).toMatchObject({ ran: true, sent: false, reason: "nothing-new" });
    expect(sendMail).not.toHaveBeenCalled();
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("keeps the watermark when the send fails, so the next run covers the same period", async () => {
    something();
    sendMail.mockRejectedValue(new Error("535 Authentication credentials invalid"));
    await expect(runAdminDigest({ now: NOW })).rejects.toThrow("535");
    expect(db.systemSetting.upsert).not.toHaveBeenCalled();
    // The claim is released even so.
    expect(db.jobClaim.update).toHaveBeenCalledWith({ where: { name: "digest.admin" }, data: { startedAt: null } });
  });

  it("prefers the configured digest address, and reports when mail is not configured", async () => {
    something();
    loadMailSettings.mockResolvedValue({ ...MAIL, digestTo: "digest@example.nz" });
    const result = await runAdminDigest({ now: NOW });
    expect(result).toMatchObject({ sent: true, to: ["digest@example.nz"] });
    expect(db.user.findMany).not.toHaveBeenCalled();

    something();
    loadMailSettings.mockResolvedValue({ ...MAIL, host: "" });
    sendMail.mockClear();
    expect(await runAdminDigest({ now: NOW })).toMatchObject({ sent: false, reason: "not-configured" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("covers the last 24 hours on a first run, and yields when another run holds the claim", async () => {
    db.systemSetting.findUnique.mockResolvedValue(null);
    nothing();
    const result = await runAdminDigest({ now: NOW });
    expect(result).toMatchObject({ since: new Date("2026-10-21T07:15:00.000Z"), until: NOW });

    db.jobClaim.updateMany.mockResolvedValue({ count: 0 });
    expect(await runAdminDigest({ now: NOW })).toEqual({ ran: false, reason: "claimed" });
  });

  it("composes a readable mail and knows an empty one", () => {
    const empty: DigestContent = {
      since: NOW,
      until: NOW,
      registered: [],
      reviewed: [],
      tokensIssued: [],
      tokensRevoked: [],
      issuesOpened: [],
      issuesStillOpen: 4,
    };
    expect(digestIsEmpty(empty)).toBe(true);
    const mail = composeDigest(
      { ...empty, reviewed: [{ name: "A <b>", code: "A", status: "APPROVED", reviewedAt: NOW }] },
      null,
    );
    expect(mail.subject).toContain("0 new requests, 0 issues opened");
    expect(mail.text).toContain("A <b> (A) — approved");
    expect(mail.html).toContain("A &lt;b&gt; (A)");
    expect(mail.text).toContain("Sync issues still open: 4");
  });
});
