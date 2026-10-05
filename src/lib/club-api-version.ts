import {
  SERVER_API_VERSION,
  apiVersionsMatch,
  parseApiVersion,
} from "@/lib/api-version";

/**
 * How a club's last REPORTED API version compares with this server's, for the
 * Clubs screen.
 *
 * - `matches`    — identical: this club can sync.
 * - `behind`     — an older version: the club's site must be upgraded; nothing is
 *                  transferred until it is.
 * - `ahead`      — a NEWER version than this server: the server must be upgraded.
 * - `unreported` — the club has never told the server a version: software older
 *                  than the version check, or one that has not checked in since.
 *
 * Both comparisons go through `api-version.ts` (integer parts, never as a number:
 * `1.10` is later than `1.9`), so this screen cannot disagree with the rule the
 * routes enforce.
 */
export type ClubApiVersionState = "matches" | "behind" | "ahead" | "unreported";

export interface ClubApiVersionStatus {
  state: ClubApiVersionState;
  /** What the club last reported, or null. */
  reported: string | null;
  serverVersion: string;
}

export function clubApiVersionStatus(
  reported: string | null | undefined,
  serverVersion: string = SERVER_API_VERSION,
): ClubApiVersionStatus {
  const club = parseApiVersion(reported);
  if (!club) return { state: "unreported", reported: null, serverVersion };
  if (apiVersionsMatch(reported, serverVersion)) {
    return { state: "matches", reported: reported as string, serverVersion };
  }
  const server = parseApiVersion(serverVersion);
  const clubIsLater =
    server !== null &&
    (club.major > server.major ||
      (club.major === server.major && club.minor > server.minor));
  return {
    state: clubIsLater ? "ahead" : "behind",
    reported: reported as string,
    serverVersion,
  };
}
