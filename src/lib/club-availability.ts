import { z } from "zod";
import { prisma } from "@/lib/db";
import { liveOtherLodgeWhere } from "@/lib/other-lodges";
import { logger } from "@/lib/logger";
import { derivePushSecret, signPushBody } from "@/lib/push-delivery";
import { assertPublicDestination } from "@/lib/push-targets";

/**
 * Asking club booking sites how many beds are free, for the public lodge
 * search (`/book`, docs/booking-search-plan.md Phase D; the booking app's
 * side is triyder/AlpineClubBookingsNZ#62).
 *
 * NOTHING IS STORED. Each search asks at the moment it runs and forgets the
 * answer; there is no table and no cache (owner decision). Any failure — no
 * push registration, an address the destination check refuses, a timeout, a
 * non-200, an answer that does not match the question — simply leaves that
 * lodge out of the result, and the page shows "beds available unknown".
 *
 * WHERE TO ASK. A club's booking site is reached at the ORIGIN of the push URL
 * it registered (`Club.pushUrl`), so a club that never registered — the
 * Communication Portal is off, or its site is not on https — is never asked.
 *
 * HOW IT IS SIGNED. With the same per-club secret the shared-post pushes use
 * (`derivePushSecret`), over `${timestamp}.availability\n<lodgeId>\n<from>\n<to>`
 * — the canonical text the booking app rebuilds from the DECODED query, so a
 * proxy re-encoding the address cannot break it, and which can never equal a
 * push body (JSON), so neither signature is accepted by the other route.
 */

/** The booking app's route, at the origin of the club's push URL. */
export const CLUB_AVAILABILITY_PATH = "/api/webhooks/servernz-availability";

/** How long one club gets to answer; the search page waits for the slowest. */
export const CLUB_AVAILABILITY_TIMEOUT_MS = 3_000;

/** How many clubs are asked at once. */
export const CLUB_AVAILABILITY_CONCURRENCY = 6;

/** The text both sides sign: domain prefix, then the three values, one per line. */
export function availabilitySignedText(query: {
  lodgeId: string;
  from: string;
  to: string;
}): string {
  return `availability\n${query.lodgeId}\n${query.from}\n${query.to}`;
}

export interface AvailabilityTarget {
  /** The central lodge id, which is what the club is asked about. */
  lodgeId: string;
  clubId: string;
  pushUrl: string;
  pushSecretVersion: number;
}

/**
 * The lodges among `lodgeIds` whose owning club can be asked: approved, with
 * a push target registered and not withdrawn.
 */
export async function loadAvailabilityTargets(
  lodgeIds: ReadonlyArray<string>,
): Promise<AvailabilityTarget[]> {
  if (lodgeIds.length === 0) return [];
  const rows = await prisma.otherLodge.findMany({
    where: {
      id: { in: [...lodgeIds] },
      ...liveOtherLodgeWhere,
      sourceClub: { status: "APPROVED", pushEnabled: true, pushUrl: { not: null } },
    },
    select: {
      id: true,
      sourceClub: { select: { id: true, pushUrl: true, pushSecretVersion: true } },
    },
  });
  return rows.flatMap((row) =>
    row.sourceClub?.pushUrl
      ? [
          {
            lodgeId: row.id,
            clubId: row.sourceClub.id,
            pushUrl: row.sourceClub.pushUrl,
            pushSecretVersion: row.sourceClub.pushSecretVersion,
          },
        ]
      : [],
  );
}

const answerSchema = z.object({
  lodgeId: z.string(),
  from: z.string(),
  to: z.string(),
  freeBeds: z.number().int().min(0).max(100_000),
});

/** Ask one club about one lodge; the free beds, or null for "unknown". */
export async function askClubForFreeBeds(
  target: AvailabilityTarget,
  stay: { from: string; to: string },
): Promise<number | null> {
  try {
    const url = new URL(CLUB_AVAILABILITY_PATH, new URL(target.pushUrl).origin);
    url.searchParams.set("lodgeId", target.lodgeId);
    url.searchParams.set("from", stay.from);
    url.searchParams.set("to", stay.to);

    // Re-checked before every call, as for pushes: DNS can be repointed.
    await assertPublicDestination(url.toString());

    const timestamp = String(Date.now());
    const secret = derivePushSecret(target.clubId, target.pushSecretVersion);
    const signature = signPushBody(
      secret,
      timestamp,
      availabilitySignedText({ lodgeId: target.lodgeId, ...stay }),
    );

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { "X-Acs-Timestamp": timestamp, "X-Acs-Signature": signature },
      // Never follow a redirect: a 302 into the private network would walk
      // straight past the destination check above.
      redirect: "manual",
      signal: AbortSignal.timeout(CLUB_AVAILABILITY_TIMEOUT_MS),
    });
    if (response.status !== 200) return null;

    const parsed = answerSchema.safeParse(await response.json());
    // The answer must be about the question asked: a club cannot answer for a
    // different lodge or stay than the one in the request.
    if (
      !parsed.success ||
      parsed.data.lodgeId !== target.lodgeId ||
      parsed.data.from !== stay.from ||
      parsed.data.to !== stay.to
    ) {
      return null;
    }
    return parsed.data.freeBeds;
  } catch (error) {
    // Expected often (a club offline, unregistered, behind a refused address):
    // logged at debug, never with the URL's query or a secret.
    logger.debug(
      { clubId: target.clubId, err: error instanceof Error ? error.message : String(error) },
      "club availability unavailable",
    );
    return null;
  }
}

/**
 * Ask every target, a few at a time, and return the free beds by central
 * lodge id. A lodge whose club did not answer is simply absent.
 */
export async function fetchFreeBeds(
  targets: ReadonlyArray<AvailabilityTarget>,
  stay: { from: string; to: string },
  ask: typeof askClubForFreeBeds = askClubForFreeBeds,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const target = targets[next++];
      const beds = await ask(target, stay);
      if (beds !== null) result.set(target.lodgeId, beds);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CLUB_AVAILABILITY_CONCURRENCY, targets.length) }, worker),
  );
  return result;
}
