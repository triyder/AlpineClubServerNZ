import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Validating the URL a club asks this server to push to.
 *
 * THIS IS AN SSRF SURFACE, and an unusually exposed one: the destination is
 * chosen by a remote party, and this server will make an authenticated request
 * to it on a schedule. Without the checks below, a club could register
 * `http://169.254.169.254/latest/meta-data/` and have the server fetch its own
 * cloud credentials, or point at `http://localhost:5432` and use the response
 * timing to map the internal network.
 *
 * Two separate checks, because either alone is insufficient:
 *
 *   * the URL SHAPE — https, no credentials, no odd port;
 *   * the RESOLVED ADDRESS — because `internal.example.com` is a perfectly
 *     ordinary hostname that resolves to 10.0.0.1.
 *
 * The address is re-checked immediately before each delivery rather than only
 * at registration, since DNS can be repointed at any time (rebinding). That
 * still leaves a window between the check and the connection; closing it
 * entirely needs a custom agent pinned to the resolved address, which is worth
 * doing if this ever carries anything more sensitive than a club's own posts.
 */

export class PushTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushTargetError";
  }
}

/**
 * Address ranges a club may never point at, as CIDR-ish prefixes checked
 * numerically below. Loopback, link-local (which is where cloud metadata
 * lives), the three private IPv4 blocks, carrier-grade NAT, and the IPv6
 * equivalents.
 */
function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:10.0.0.1) is an IPv4 address wearing a hat.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

/** True when this literal address must never be connected to. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true;
}

/**
 * Check the SHAPE of a push URL. Cheap, synchronous, no DNS.
 *
 * Returns the canonical URL string, or throws with a message written for the
 * operator of the club that submitted it.
 */
export function validatePushUrlShape(input: string): string {
  const raw = (input ?? "").trim();
  if (raw.length === 0) throw new PushTargetError("Enter a URL to push to.");
  if (raw.length > 2000) throw new PushTargetError("That URL is too long.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PushTargetError("That is not a valid URL.");
  }

  // HTTPS ONLY. The payload carries a signature and a club's member-written
  // content; plain http would put both on the wire in clear, and would also
  // let anyone on the path feed the club forged posts.
  if (url.protocol !== "https:") {
    throw new PushTargetError("The URL must start with https://.");
  }
  // Credentials in a URL are a way to smuggle a different host past a naive
  // parser (https://good.example@evil.test/), and are never legitimate here.
  if (url.username || url.password) {
    throw new PushTargetError("The URL must not contain a username or password.");
  }
  if (url.hash) {
    throw new PushTargetError("The URL must not contain a fragment.");
  }
  // A literal IP is refused outright rather than merely range-checked: a club
  // install is reached by name, and allowing literals removes a whole class of
  // parsing ambiguity for nothing gained.
  //
  // THE BRACKETS MATTER. `URL.hostname` returns an IPv6 literal still wrapped
  // in them — "[::1]" — and `isIP("[::1]")` is 0, so checking the raw hostname
  // lets every IPv6 literal through, loopback included. Found by the test that
  // registers `https://[::1]/push`.
  const bareHost = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bareHost) !== 0) {
    throw new PushTargetError("Use a hostname rather than an IP address.");
  }
  if (url.port && url.port !== "443") {
    throw new PushTargetError("The URL must use the default HTTPS port.");
  }

  return url.toString();
}

/**
 * Resolve the host and refuse anything that lands inside the network.
 *
 * Called at registration AND immediately before each delivery, because a
 * hostname that resolved publicly last week can be repointed at 127.0.0.1
 * today.
 */
export async function assertPublicDestination(url: string): Promise<void> {
  // Unbracketed for the same reason the shape check strips them: a DNS lookup
  // of "[::1]" is not a lookup of "::1".
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new PushTargetError("That hostname could not be resolved.");
  }
  if (addresses.length === 0) {
    throw new PushTargetError("That hostname could not be resolved.");
  }

  // EVERY address must be acceptable, not merely one of them: a host with both
  // a public and a private record would otherwise pass here and connect to
  // whichever the resolver returned first at delivery time.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new PushTargetError(
        "That hostname resolves to an address inside a private network.",
      );
    }
  }
}

/** Shape check plus resolution. What registration should call. */
export async function validatePushTarget(input: string): Promise<string> {
  const url = validatePushUrlShape(input);
  await assertPublicDestination(url);
  return url;
}
