import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { z } from "zod";

import { SERVER_API_VERSION } from "@/lib/api-version";
import fingerprints from "@/lib/api-contract-fingerprints.json";
import {
  otherLodgeUploadSchema,
  serializeOtherLodgeForClient,
  type OtherLodgeRecord,
} from "@/lib/other-lodges";
import {
  reportPostSchema,
  serializePostForClient,
  sharePostSchema,
  type PostRecord,
} from "@/lib/posts";
import { clubRegisterSchema, syncSchema } from "@/lib/validation";

/**
 * THE CONTRACT GUARD for SERVER_API_VERSION (`src/lib/api-version.ts`).
 *
 * A club syncs only while its API version equals this server's, so the version
 * is only worth anything if it moves when the contract does. This test
 * fingerprints every `/api/v1` surface a club can see — which routes exist with
 * which methods, every accepted request schema, and the exact keys of what the
 * server sends back — and fails when the fingerprint stops matching the one
 * recorded for the current version.
 *
 * WHEN IT FAILS. You changed a v1 request or response shape. Bump
 * SERVER_API_VERSION, then add the NEW fingerprint (printed below) under the NEW
 * version in `api-contract-fingerprints.json`. Never overwrite an existing
 * entry: that entry is the record of what that version meant, and rewriting it
 * is how a contract changes silently under clubs that think they match.
 */

const V1_ROOT = join(process.cwd(), "src", "app", "api", "v1");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : routeFiles(full);
    }
    return name === "route.ts" ? [full] : [];
  });
}

function routeSurface(): string[] {
  return routeFiles(V1_ROOT)
    .map((file) => {
      const methods = [
        ...readFileSync(file, "utf8").matchAll(
          /export async function (GET|POST|PUT|PATCH|DELETE)\b/g,
        ),
      ]
        .map((m) => m[1])
        .sort();
      const path = file
        .slice(V1_ROOT.length)
        .replace(/\\/g, "/")
        .replace(/\/route\.ts$/, "");
      return `${path || "/"} ${methods.join(",")}`;
    })
    .sort();
}

function schemaOf(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

const at = new Date("2026-01-01T00:00:00.000Z");

const lodgeFixture = {
  id: "l",
  name: "n",
  location: null,
  bookingOfficerName: null,
  bookingOfficerEmail: null,
  bookingOfficerPhone: null,
  bedCapacity: null,
  siteUrl: null,
  bookingPath: null,
  requiresLodgeCustodian: false,
  freeWifi: false,
  quietRoom: false,
  dryingRoom: false,
  sharedKitchen: false,
  wheelchairAccessible: false,
  breakfastIncluded: false,
  lunchIncluded: false,
  dinnerIncluded: false,
  cancellationPeriod: null,
  winterSeasonStart: new Date("2026-06-01T00:00:00.000Z"),
  summerSeasonStart: null,
  // One entry, so the guard pins the amenity object's keys as well as the array.
  amenities: [{ name: "n", description: null }],
  distribute: true,
  sourceClubId: null,
  sourceClub: null,
  lastUpdatedByClubId: null,
  lastUpdatedByClub: null,
  lastUploadedAt: null,
  createdAt: at,
  updatedAt: at,
} as unknown as OtherLodgeRecord;

const postFixture = {
  id: "p",
  clubId: "c",
  club: { id: "c", name: "n", code: "k" },
  authorUserId: "u",
  authorName: "a",
  authorEmail: null,
  content: "c",
  bodyHtml: null,
  reportCount: 0,
  hiddenAt: null,
  hiddenBy: null,
  autoHideExempt: false,
  removedAt: null,
  removedBy: null,
  createdAt: at,
  updatedAt: at,
  images: [
    { id: "i", publicId: "x", storageKey: "s", width: 1, height: 1, bytes: 1, position: 0 },
  ],
} as unknown as PostRecord;

function keysOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [keysOf(value[0])] : [];
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, keysOf((value as Record<string, unknown>)[k])]),
    );
  }
  return value === null ? "null" : typeof value;
}

export function currentContractFingerprint(): string {
  const surface = {
    routes: routeSurface(),
    requests: {
      otherLodgeUpload: schemaOf(otherLodgeUploadSchema),
      sync: schemaOf(syncSchema),
      sharePost: schemaOf(sharePostSchema),
      reportPost: schemaOf(reportPostSchema),
      clubRegister: schemaOf(clubRegisterSchema),
    },
    responses: {
      otherLodge: keysOf(serializeOtherLodgeForClient(lodgeFixture)),
      post: keysOf(serializePostForClient(postFixture, "https://example.test")),
    },
  };
  return createHash("sha256").update(JSON.stringify(surface)).digest("hex");
}

describe("API contract fingerprint", () => {
  it("has a recorded fingerprint for the current SERVER_API_VERSION", () => {
    expect(
      Object.keys(fingerprints),
      `SERVER_API_VERSION is ${SERVER_API_VERSION} but api-contract-fingerprints.json has no entry for it. Add one — fingerprint: ${currentContractFingerprint()}`,
    ).toContain(SERVER_API_VERSION);
  });

  it("still matches the fingerprint recorded for the current version", () => {
    const recorded = (fingerprints as Record<string, string>)[SERVER_API_VERSION];
    const current = currentContractFingerprint();
    expect(
      current,
      `A /api/v1 request or response shape changed without a version bump. Bump SERVER_API_VERSION and add "${current}" under the new version in api-contract-fingerprints.json. Do not overwrite the entry for ${SERVER_API_VERSION}.`,
    ).toBe(recorded);
  });

  it("covers the version route itself", () => {
    expect(routeSurface()).toContain("/version GET");
  });
});
