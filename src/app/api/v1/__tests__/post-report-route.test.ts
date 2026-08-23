import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Mock token auth: tests set what the authenticated client looks like.
const authenticate = vi.fn();
vi.mock("@/lib/api-auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    authenticateApiRequest: (...a: unknown[]) => authenticate(...a),
  };
});

const settings = vi.fn();
vi.mock("@/lib/settings", () => ({
  loadPostSettings: () => settings(),
}));

const postFindFirst = vi.fn();
const postUpdate = vi.fn().mockResolvedValue({});
const reportCreate = vi.fn();
const reportFindMany = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});

const tx = {
  post: {
    findFirst: (...a: unknown[]) => postFindFirst(...a),
    update: (...a: unknown[]) => postUpdate(...a),
  },
  postReport: {
    create: (...a: unknown[]) => reportCreate(...a),
    findMany: (...a: unknown[]) => reportFindMany(...a),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { POST } from "@/app/api/v1/posts/[id]/report/route";
import { resetRateLimits } from "@/lib/rate-limit";

const CLUB = { id: "club_1", code: "RUAPEHU", status: "APPROVED" };

function authOk(scopes: string[] = ["posts:write"], clubId = CLUB.id) {
  return {
    ok: true,
    client: {
      club: { ...CLUB, id: clubId },
      token: { id: `tok_${clubId}`, scopes },
    },
  };
}

function req(body: unknown) {
  return new Request("https://server.test/api/v1/posts/p1/report", {
    method: "POST",
    headers: {
      authorization: "Bearer acs_x_y",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "p1" }) };

const VALID = { reporter_user_id: "m1", reason: "SPAM" as const };

/** Open reports as the recount query would return them. */
function openReports(...clubIds: string[]) {
  return clubIds.map((reporterClubId) => ({ reporterClubId }));
}

/** The data passed to post.update, i.e. what actually got written. */
function updatedWith() {
  return postUpdate.mock.calls.at(-1)?.[0]?.data as Record<string, unknown>;
}

beforeEach(() => {
  resetRateLimits();
  authenticate.mockReset().mockResolvedValue(authOk());
  postFindFirst
    .mockReset()
    .mockResolvedValue({ id: "p1", hiddenAt: null, autoHideExempt: false });
  postUpdate.mockReset().mockResolvedValue({});
  reportCreate.mockReset().mockResolvedValue({});
  reportFindMany.mockReset().mockResolvedValue(openReports("club_1"));
  auditCreate.mockReset().mockResolvedValue({});
  settings.mockReset().mockResolvedValue({
    retentionDays: 365,
    autoHideThreshold: 3,
    autoHideMinClubs: 1,
    tombstoneHorizonDays: 90,
  });
});

describe("POST /api/v1/posts/:id/report — auth and validation", () => {
  it("rejects a token without posts:write", async () => {
    authenticate.mockResolvedValue(authOk(["posts:read"]));
    const res = await POST(req(VALID), ctx);
    expect(res.status).toBe(403);
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown reason", async () => {
    const res = await POST(
      req({ reporter_user_id: "m1", reason: "BECAUSE" }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields rather than silently ignoring them", async () => {
    const res = await POST(req({ ...VALID, hidden: true }), ctx);
    expect(res.status).toBe(400);
  });

  it("404s for a post that is missing or already removed", async () => {
    postFindFirst.mockResolvedValue(null);
    const res = await POST(req(VALID), ctx);
    expect(res.status).toBe(404);
    // The query itself excludes removed posts, so a stub row is unreportable.
    expect(postFindFirst.mock.calls[0][0].where).toMatchObject({
      removedAt: null,
    });
  });
});

describe("POST /api/v1/posts/:id/report — the auto-hide threshold", () => {
  it("does not hide on the second report", async () => {
    reportFindMany.mockResolvedValue(openReports("club_1", "club_2"));

    const res = await POST(req(VALID), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "recorded", hidden: false });
    expect(updatedWith()).toEqual({ reportCount: 2 });
    expect(updatedWith().hiddenAt).toBeUndefined();
  });

  it("hides on the third — the boundary the whole control rests on", async () => {
    reportFindMany.mockResolvedValue(
      openReports("club_1", "club_2", "club_3"),
    );

    const res = await POST(req(VALID), ctx);
    const body = await res.json();

    expect(body).toEqual({ status: "recorded", hidden: true });
    expect(updatedWith().reportCount).toBe(3);
    expect(updatedWith().hiddenBy).toBe("SYSTEM");
    expect(updatedWith().hiddenAt).toBeInstanceOf(Date);
  });

  it("hides on three reports from ONE club, per decision 01", async () => {
    // min_clubs defaults to 1, so a single club reaching the count is enough.
    // This is the accepted trade: fast and reversible, not a verdict.
    reportFindMany.mockResolvedValue(
      openReports("club_1", "club_1", "club_1"),
    );

    const body = await (await POST(req(VALID), ctx)).json();
    expect(body.hidden).toBe(true);
  });

  it("respects a raised auto_hide_min_clubs", async () => {
    // The lever an admin pulls if flag abuse appears: same three reports, but
    // now they must come from two distinct clubs.
    settings.mockResolvedValue({
      retentionDays: 365,
      autoHideThreshold: 3,
      autoHideMinClubs: 2,
      tombstoneHorizonDays: 90,
    });
    reportFindMany.mockResolvedValue(
      openReports("club_1", "club_1", "club_1"),
    );

    const body = await (await POST(req(VALID), ctx)).json();
    expect(body.hidden).toBe(false);
    expect(updatedWith().reportCount).toBe(3);
  });

  it("never re-hides a post an admin exempted", async () => {
    // Without this, unhiding a targeted post just restarts the countdown and
    // it re-hides at the next three reports, forever.
    postFindFirst.mockResolvedValue({
      id: "p1",
      hiddenAt: null,
      autoHideExempt: true,
    });
    reportFindMany.mockResolvedValue(
      openReports("club_1", "club_2", "club_3"),
    );

    const body = await (await POST(req(VALID), ctx)).json();
    expect(body.hidden).toBe(false);
    // The count still moves, so the console can show it is being reported.
    expect(updatedWith().reportCount).toBe(3);
  });

  it("does not re-stamp a post that is already hidden", async () => {
    postFindFirst.mockResolvedValue({
      id: "p1",
      hiddenAt: new Date("2026-08-01T00:00:00Z"),
      autoHideExempt: false,
    });
    reportFindMany.mockResolvedValue(
      openReports("club_1", "club_2", "club_3", "club_4"),
    );

    const body = await (await POST(req(VALID), ctx)).json();
    expect(body.hidden).toBe(false);
    expect(updatedWith().hiddenAt).toBeUndefined();
  });

  it("counts only non-dismissed reports", async () => {
    await POST(req(VALID), ctx);
    expect(reportFindMany.mock.calls[0][0].where).toMatchObject({
      postId: "p1",
      dismissedAt: null,
    });
  });
});

describe("POST /api/v1/posts/:id/report — duplicates", () => {
  it("returns 200 without recounting when the member already reported", async () => {
    reportCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dupe", {
        code: "P2002",
        clientVersion: "7",
      }),
    );

    const res = await POST(req(VALID), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "duplicate", hidden: false });
    // The crucial part: a retry whose first response was lost must not be able
    // to nudge the post closer to the threshold.
    expect(reportFindMany).not.toHaveBeenCalled();
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("scopes the report to the authenticated club, not the request body", async () => {
    authenticate.mockResolvedValue(authOk(["posts:write"], "club_9"));
    await POST(req(VALID), ctx);

    expect(reportCreate.mock.calls[0][0].data).toMatchObject({
      reporterClubId: "club_9",
      reporterUserId: "m1",
    });
  });

  it("surfaces a non-unique database error rather than reporting success", async () => {
    reportCreate.mockRejectedValue(new Error("connection reset"));
    await expect(POST(req(VALID), ctx)).rejects.toThrow("connection reset");
  });
});
