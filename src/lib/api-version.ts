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
export const SERVER_API_VERSION = "1.0";

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

/**
 * The version a request declares, or `null` when it declares none.
 * `undefined` means it declared something that is not a valid version.
 */
export function readClientApiVersion(req: Request): string | null | undefined {
  const raw =
    req.headers.get(CLIENT_API_VERSION_HEADER) ??
    new URL(req.url).searchParams.get("clientVersion");
  if (raw === null) return null;
  const trimmed = raw.trim();
  return parseApiVersion(trimmed) ? trimmed : undefined;
}
