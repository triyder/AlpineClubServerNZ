import { describe, expect, it } from "vitest";

import { rewriteImageSources, sanitizeSharedHtml } from "@/lib/post-html";

/**
 * Shared-body sanitising and image rewriting.
 *
 * This is the network's trust boundary. A club authenticates with an API key,
 * which proves WHICH CLUB is calling and nothing at all about what its members
 * wrote — and whatever survives here is handed to every other club's browser.
 * So the tests are about what does not get through.
 */

const LOCAL = "a".repeat(32);
const SERVER = "b".repeat(32);

describe("rewriteImageSources", () => {
  it("maps the sending club's image URLs onto this server's copies", () => {
    const html = `<p><img src="/api/club-posts/images/${LOCAL}"></p>`;
    const out = rewriteImageSources(html, new Map([[LOCAL, SERVER]]));
    expect(out).toContain(`/api/images/posts/${SERVER}.webp`);
    expect(out).not.toContain(LOCAL);
  });

  it("leaves an unmapped image alone, so the sanitiser then drops it", () => {
    const html = `<img src="/api/club-posts/images/${LOCAL}">`;
    const rewritten = rewriteImageSources(html, new Map());
    // Still the sender's URL...
    expect(rewritten).toContain("/api/club-posts/images/");
    // ...and therefore gone once sanitised, rather than left pointing at a host
    // the reader cannot reach and which would learn that they read it.
    expect(sanitizeSharedHtml(rewritten)).toBeNull();
  });

  it("maps several images by position", () => {
    const second = "c".repeat(32);
    const html = `<img src="/api/club-posts/images/${LOCAL}"><img src="/api/club-posts/images/${second}">`;
    const out = rewriteImageSources(
      html,
      new Map([
        [LOCAL, SERVER],
        [second, "d".repeat(32)],
      ]),
    );
    expect(out).toContain(`${SERVER}.webp`);
    expect(out).toContain(`${"d".repeat(32)}.webp`);
  });
});

describe("sanitizeSharedHtml", () => {
  it("keeps the formatting a club is allowed to send", () => {
    const out = sanitizeSharedHtml(
      '<p style="text-align:justify"><b>Road</b> <span style="color:#b42318">closed</span></p>',
    );
    expect(out).toContain("<b>Road</b>");
    expect(out).toContain("text-align:justify");
    expect(out).toContain("color:#b42318");
  });

  it("drops script even though the sender was authenticated", () => {
    // The point of the whole module: an API key proves which club is calling,
    // not that its members' markup is safe.
    const out = sanitizeSharedHtml("<p>hi</p><script>alert(1)</script>");
    expect(out).toBe("<p>hi</p>");
  });

  it("drops an event handler", () => {
    expect(sanitizeSharedHtml('<p onmouseover="steal()">x</p>')).toBe("<p>x</p>");
  });

  it("drops an image pointing anywhere but this server", () => {
    expect(
      sanitizeSharedHtml('<img src="https://tracker.test/pixel.gif">'),
    ).toBeNull();
  });

  it("keeps an image already pointing at this server, with or without .webp", () => {
    expect(sanitizeSharedHtml(`<img src="/api/images/posts/${SERVER}.webp">`)).toContain(
      SERVER,
    );
    expect(sanitizeSharedHtml(`<img src="/api/images/posts/${SERVER}">`)).toContain(
      SERVER,
    );
  });

  it("drops a style smuggled after an allowed one", () => {
    const out = sanitizeSharedHtml(
      '<span style="color:#b42318;position:fixed">x</span>',
    );
    expect(out).toContain("color:#b42318");
    expect(out).not.toContain("position");
  });

  it("returns null rather than an empty string for nothing usable", () => {
    // The column is nullable and `content` stays authoritative, so "nothing
    // survived" must be storable as null rather than as an empty body.
    expect(sanitizeSharedHtml("<script>x</script>")).toBeNull();
    expect(sanitizeSharedHtml("   ")).toBeNull();
    expect(sanitizeSharedHtml(null)).toBeNull();
    expect(sanitizeSharedHtml(undefined)).toBeNull();
  });
});
