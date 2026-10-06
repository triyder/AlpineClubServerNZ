/**
 * The central server's API version — one `major.minor` number for the WHOLE
 * `/api/v1` contract (other lodges, the message board, push registration and
 * anything added later), not for any one table.
 *
 * HOW A CLUB USES IT. A club asks `GET /api/v1/version`, compares the answer to
 * the version it was built for, and syncs only when the two are identical.
 * Anything else — a different minor included — pauses all transfer, both ways.
 * That makes a bump a deliberate act: raising even the minor number pauses
 * every club until each is upgraded.
 *
 * WHEN TO BUMP. Bump the major when a v1 request or response shape changes
 * incompatibly, the minor for a bug fix or a behaviour change a club should be
 * upgraded for. `api-contract.test.ts` fingerprints the v1 shapes and fails when
 * they change without a new entry in `api-contract-fingerprints.json`.
 *
 * COMPARISON IS BY INTEGER PARTS, NEVER AS A NUMBER. `1.10` is a later version
 * than `1.1`, and as floating-point numbers they are equal. Every comparison in
 * the server goes through `apiVersionsMatch`, which is the one home for the rule.
 */
export const SERVER_API_VERSION = "2.1";

/** Header a club sends its own version in; `?clientVersion=` is also accepted. */
export const CLIENT_API_VERSION_HEADER = "x-client-api-version";

/**
 * Canonical form only: no leading zeros, no sign, no whitespace, so one version
 * has exactly one spelling and string equality could never disagree with the
 * integer comparison below.
 */
const API_VERSION_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export interface ParsedApiVersion {
  major: number;
  minor: number;
}

export function parseApiVersion(raw: unknown): ParsedApiVersion | null {
  if (typeof raw !== "string") return null;
  const match = API_VERSION_PATTERN.exec(raw);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** True only when both are valid versions with the same major AND minor. */
export function apiVersionsMatch(a: unknown, b: unknown): boolean {
  const left = parseApiVersion(a);
  const right = parseApiVersion(b);
  if (!left || !right) return false;
  return left.major === right.major && left.minor === right.minor;
}

/** The raw declared version, exactly as sent, or `null` when none was sent. */
export function readRawClientApiVersion(req: Request): string | null {
  return (
    req.headers.get(CLIENT_API_VERSION_HEADER) ??
    new URL(req.url).searchParams.get("clientVersion")
  );
}

/**
 * The version a request declares, or `null` when it declares none.
 * `undefined` means it declared something that is not a valid version.
 */
export function readClientApiVersion(req: Request): string | null | undefined {
  const raw = readRawClientApiVersion(req);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return parseApiVersion(trimmed) ? trimmed : undefined;
}

/** Longest malformed declared value kept in an audit row. */
export const DECLARED_VERSION_AUDIT_MAX = 64;

/**
 * A malformed declared version as it is written to the audit log: control
 * characters stripped and the length capped, so a hostile header cannot put a
 * terminal escape or a megabyte into a row an administrator reads.
 */
export function describeDeclaredVersion(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .slice(0, DECLARED_VERSION_AUDIT_MAX);
}

export const API_VERSION_INVALID_CODE = "API_VERSION_INVALID";

/**
 * The one 400 body for a malformed declared version, shared by the gate and by
 * `GET /api/v1/version` so the two cannot answer the same mistake differently.
 * `serverVersion` is the name the documented 409 mismatch body uses.
 */
export function invalidClientApiVersionBody() {
  return {
    error: "Invalid client API version",
    code: API_VERSION_INVALID_CODE,
    serverVersion: SERVER_API_VERSION,
  };
}
