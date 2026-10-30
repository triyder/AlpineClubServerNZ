import { PROTECTED_PREFIXES } from "@/proxy";

/**
 * The console page to return to after sign-in (`/login?next=…`), or null.
 *
 * The value arrives in a URL anyone can send an administrator, so it is held to
 * the narrowest thing that is useful: a path on THIS site under one of the
 * console's own prefixes. Anything else (another origin, `//host`, `/\host`, a
 * scheme, control characters, the public pages) is ignored and sign-in goes to
 * the dashboard as before. That is what keeps it from being an open redirect.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001F\u007F]/.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, "http://console.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://console.invalid") return null;

  const { pathname } = url;
  const underConsole = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return underConsole ? `${pathname}${url.search}` : null;
}
