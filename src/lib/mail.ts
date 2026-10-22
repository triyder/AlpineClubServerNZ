import "server-only";
import { z } from "zod";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { openSecret, sealSecret, secretBoxAvailable } from "@/lib/secret-box";

/**
 * Outbound mail (#33): the SMTP settings an administrator enters under
 * Settings, and the ONE `sendMail` every sender uses, so the transport, the
 * from-address and the error handling live here and nowhere else. Nothing
 * else in the server constructs a transport.
 *
 * The password is sealed with `secret-box` before it reaches the database and
 * is never returned to a page: readers get `passwordSet`, a boolean.
 */

export const MAIL_SETTING_KEYS = {
  host: "smtp.host",
  port: "smtp.port",
  security: "smtp.security",
  user: "smtp.user",
  password: "smtp.password",
  fromAddress: "smtp.from_address",
  fromName: "smtp.from_name",
} as const;

/** How the connection is secured. `tls` = implicit TLS (usually 465). */
export const MAIL_SECURITY = ["starttls", "tls", "none"] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];

/** What a page may see: everything but the password. */
export interface MailSettingsView {
  host: string;
  port: number;
  security: MailSecurity;
  user: string;
  passwordSet: boolean;
  fromAddress: string;
  fromName: string;
}

export const MAIL_SETTINGS_DEFAULTS: MailSettingsView = {
  host: "",
  port: 587,
  security: "starttls",
  user: "",
  passwordSet: false,
  fromAddress: "",
  fromName: "",
};

/**
 * What the page sends back. `password` absent or empty keeps the stored one;
 * a value replaces it. Clearing a password is done by clearing the host.
 */
export const mailSettingsInputSchema = z.object({
  host: z.string().trim().max(253),
  port: z.number().int().min(1).max(65535),
  security: z.enum(MAIL_SECURITY),
  user: z.string().trim().max(320),
  password: z.string().max(1024).optional(),
  fromAddress: z.string().trim().email().max(320).or(z.literal("")),
  fromName: z.string().trim().max(120),
});
export type MailSettingsInput = z.infer<typeof mailSettingsInputSchema>;

async function readRows(): Promise<Map<string, string>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(MAIL_SETTING_KEYS) } },
    select: { key: true, value: true },
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

function viewFrom(byKey: Map<string, string>): MailSettingsView {
  const port = Number(byKey.get(MAIL_SETTING_KEYS.port));
  const security = byKey.get(MAIL_SETTING_KEYS.security);
  return {
    host: byKey.get(MAIL_SETTING_KEYS.host) ?? MAIL_SETTINGS_DEFAULTS.host,
    port: Number.isInteger(port) && port > 0 ? port : MAIL_SETTINGS_DEFAULTS.port,
    security: (MAIL_SECURITY as readonly string[]).includes(security ?? "")
      ? (security as MailSecurity)
      : MAIL_SETTINGS_DEFAULTS.security,
    user: byKey.get(MAIL_SETTING_KEYS.user) ?? "",
    passwordSet: Boolean(byKey.get(MAIL_SETTING_KEYS.password)),
    fromAddress: byKey.get(MAIL_SETTING_KEYS.fromAddress) ?? "",
    fromName: byKey.get(MAIL_SETTING_KEYS.fromName) ?? "",
  };
}

/** Read the settings for a page. The password is reported as set or not, never returned. */
export async function loadMailSettings(): Promise<MailSettingsView> {
  try {
    return viewFrom(await readRows());
  } catch (err) {
    logger.error({ err }, "failed to read mail settings; using defaults");
    return { ...MAIL_SETTINGS_DEFAULTS };
  }
}

export class MailSettingsError extends Error {}

/**
 * Save the settings. A new password is sealed first, which needs
 * `SETTINGS_ENCRYPTION_KEY`; without it the save is refused rather than
 * storing the password in the clear.
 */
export async function saveMailSettings(input: MailSettingsInput): Promise<MailSettingsView> {
  const pairs: [string, string][] = [
    [MAIL_SETTING_KEYS.host, input.host],
    [MAIL_SETTING_KEYS.port, String(input.port)],
    [MAIL_SETTING_KEYS.security, input.security],
    [MAIL_SETTING_KEYS.user, input.user],
    [MAIL_SETTING_KEYS.fromAddress, input.fromAddress],
    [MAIL_SETTING_KEYS.fromName, input.fromName],
  ];
  if (input.password) {
    if (!secretBoxAvailable()) {
      throw new MailSettingsError(
        "SETTINGS_ENCRYPTION_KEY is not set on the server, so the SMTP password cannot be stored. Set it (at least 32 characters) and try again.",
      );
    }
    pairs.push([MAIL_SETTING_KEYS.password, sealSecret(input.password)]);
  }
  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      }),
    ),
  );
  return loadMailSettings();
}

/** True when enough is set to attempt a send: a host and a from-address. */
export function mailConfigured(view: MailSettingsView): boolean {
  return view.host.length > 0 && view.fromAddress.length > 0;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class MailNotConfiguredError extends Error {}

/**
 * Send one message through the configured SMTP server. Throws
 * `MailNotConfiguredError` when no server is set, and the transport's own error
 * verbatim when the server refuses, so the Settings page can show the
 * operator exactly what the provider said.
 */
export async function sendMail(message: MailMessage): Promise<{ messageId: string }> {
  const byKey = await readRows();
  const view = viewFrom(byKey);
  if (!mailConfigured(view)) {
    throw new MailNotConfiguredError("No SMTP server is configured under Settings → Email.");
  }
  const sealed = byKey.get(MAIL_SETTING_KEYS.password);
  const password = sealed ? openSecret(sealed) : undefined;

  const transport = nodemailer.createTransport({
    host: view.host,
    port: view.port,
    secure: view.security === "tls",
    ignoreTLS: view.security === "none",
    requireTLS: view.security === "starttls",
    auth: view.user ? { user: view.user, pass: password ?? "" } : undefined,
  });
  const from = view.fromName ? `"${view.fromName.replace(/"/g, "")}" <${view.fromAddress}>` : view.fromAddress;
  const info = await transport.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
  logger.info({ to: message.to, messageId: info.messageId }, "mail sent");
  return { messageId: info.messageId };
}
