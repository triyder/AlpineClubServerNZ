import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { clubApiVersionStatus } from "@/lib/club-api-version";
import { SERVER_API_VERSION } from "@/lib/api-version";
import { ClubApiVersion } from "@/components/club-api-version";

describe("clubApiVersionStatus", () => {
  it("matches only an identical version, against this server's by default", () => {
    expect(clubApiVersionStatus(SERVER_API_VERSION)).toEqual({
      state: "matches",
      reported: SERVER_API_VERSION,
      serverVersion: SERVER_API_VERSION,
    });
  });

  it.each([
    ["1.9", "2.0", "behind"],
    ["1.10", "2.0", "behind"],
    ["2.0", "2.1", "behind"],
    ["2.1", "2.0", "ahead"],
    ["3.0", "2.0", "ahead"],
    ["2.10", "2.9", "ahead"],
    ["2.9", "2.10", "behind"],
  ])("club %s against server %s is %s (compared by integer parts, never as a number)", (club, server, state) => {
    expect(clubApiVersionStatus(club, server).state).toBe(state);
  });

  it("treats 2.10 and 2.1 as different versions, not equal", () => {
    expect(clubApiVersionStatus("2.10", "2.1").state).toBe("ahead");
    expect(clubApiVersionStatus("2.1", "2.10").state).toBe("behind");
  });

  it.each([null, undefined, "", "banana", "2", "2.0.0", "02.0"])(
    "a club that reported %j is unreported",
    (reported) => {
      expect(clubApiVersionStatus(reported as string | null)).toEqual({
        state: "unreported",
        reported: null,
        serverVersion: SERVER_API_VERSION,
      });
    },
  );
});

describe("ClubApiVersion display", () => {
  const at = new Date("2026-10-04T12:03:45.000Z");
  const html = (reported: string | null, checkedAt: Date | null = at) =>
    renderToStaticMarkup(
      createElement(ClubApiVersion, { reported, checkedAt, serverVersion: "2.0" }),
    );

  it("shows a matching club as up to date, with no action text", () => {
    const out = html("2.0");
    expect(out).toContain("Version 2.0 · up to date");
    expect(out).not.toContain("nothing is transferred");
    expect(out).not.toContain("See Issues");
  });

  it("shows a club behind, says what that means, and links to Issues", () => {
    const out = html("1.1");
    expect(out).toContain("Version 1.1 · behind");
    expect(out).toContain("This server is on 2.0");
    expect(out).toContain("nothing is transferred");
    expect(out).toContain('href="/issues"');
  });

  it("shows a club ahead as a server upgrade, not a club problem", () => {
    const out = html("3.0");
    expect(out).toContain("Version 3.0 · newer than this server");
    expect(out).toContain("until the server is upgraded");
  });

  it("shows a club that never reported, without calling it a mismatch", () => {
    const out = html(null, null);
    expect(out).toContain("Version not reported");
    expect(out).toContain("not refused");
    expect(out).not.toContain("behind");
    expect(out).not.toContain("last checked");
  });

  it("shows when the club last checked, in UTC, to the minute", () => {
    expect(html("2.0")).toContain("last checked 2026-10-04 12:03 UTC");
  });
});
