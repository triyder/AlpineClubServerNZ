import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findMany = vi.fn();
const upsert = vi.fn();
const transaction = vi.fn();
const createTransport = vi.fn();
const transportSendMail = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findMany: (...a: unknown[]) => findMany(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: (...a: unknown[]) => createTransport(...a) },
}));

import {
  loadMailSettings,
  MailNotConfiguredError,
  MailSettingsError,
  saveMailSettings,
  sendMail,
} from "@/lib/mail";
import { sealSecret } from "@/lib/secret-box";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";

function rows(map: Record<string, string>) {
  findMany.mockResolvedValue(Object.entries(map).map(([key, value]) => ({ key, value })));
}

describe("mail settings (#33)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.SETTINGS_ENCRYPTION_KEY = KEY;
    findMany.mockReset();
    upsert.mockReset();
    transaction.mockReset();
    createTransport.mockReset();
    transportSendMail.mockReset();
    upsert.mockImplementation(async (args: unknown) => args);
    transaction.mockImplementation(async (ops: unknown[]) => ops);
    createTransport.mockReturnValue({ sendMail: transportSendMail });
    transportSendMail.mockResolvedValue({ messageId: "<m1>" });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = saved;
  });

  it("reports the password as set or not, and never returns it", async () => {
    rows({
      "smtp.host": "smtp.example.net",
      "smtp.port": "465",
      "smtp.security": "tls",
      "smtp.user": "u",
      "smtp.password": sealSecret("hunter2"),
      "smtp.from_address": "server@example.nz",
      "smtp.from_name": "Server",
    });
    const view = await loadMailSettings();
    expect(view).toEqual({
      host: "smtp.example.net",
      port: 465,
      security: "tls",
      user: "u",
      passwordSet: true,
      fromAddress: "server@example.nz",
      fromName: "Server",
      digestTo: "",
    });
    expect(JSON.stringify(view)).not.toContain("hunter2");
  });

  it("defaults an empty or malformed store", async () => {
    rows({ "smtp.port": "not-a-port", "smtp.security": "carrier-pigeon" });
    expect(await loadMailSettings()).toMatchObject({
      host: "",
      port: 587,
      security: "starttls",
      passwordSet: false,
    });
  });

  it("seals a new password before it reaches the database, and keeps the old one when none is given", async () => {
    rows({});
    await saveMailSettings({
      host: "smtp.example.net",
      port: 587,
      security: "starttls",
      user: "u",
      password: "hunter2",
      fromAddress: "server@example.nz",
      fromName: "",
      digestTo: "",
    });
    const writes = upsert.mock.calls.map(([args]) => (args as { create: { key: string; value: string } }).create);
    const pw = writes.find((w) => w.key === "smtp.password");
    expect(pw?.value).toMatch(/^v1:/);
    expect(pw?.value).not.toContain("hunter2");

    upsert.mockClear();
    await saveMailSettings({
      host: "smtp.example.net",
      port: 587,
      security: "starttls",
      user: "u",
      fromAddress: "server@example.nz",
      fromName: "",
      digestTo: "",
    });
    const keys = upsert.mock.calls.map(([args]) => (args as { where: { key: string } }).where.key);
    expect(keys).not.toContain("smtp.password");
  });

  it("refuses to store a password without the encryption key, rather than storing it in the clear", async () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    await expect(
      saveMailSettings({
        host: "smtp.example.net",
        port: 587,
        security: "starttls",
        user: "u",
        password: "hunter2",
        fromAddress: "server@example.nz",
        fromName: "",
        digestTo: "",
      }),
    ).rejects.toThrow(MailSettingsError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("sends through the configured server with the unsealed password, and refuses when nothing is configured", async () => {
    rows({
      "smtp.host": "smtp.example.net",
      "smtp.port": "587",
      "smtp.security": "starttls",
      "smtp.user": "u",
      "smtp.password": sealSecret("hunter2"),
      "smtp.from_address": "server@example.nz",
      "smtp.from_name": "Alpine \"Server\"",
    });
    const result = await sendMail({ to: "admin@example.nz", subject: "Hi", text: "body" });
    expect(result).toEqual({ messageId: "<m1>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.net",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "u", pass: "hunter2" },
      }),
    );
    expect(transportSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Alpine Server" <server@example.nz>', to: "admin@example.nz" }),
    );

    rows({});
    await expect(sendMail({ to: "a@b.nz", subject: "x", text: "y" })).rejects.toThrow(
      MailNotConfiguredError,
    );
  });
});
