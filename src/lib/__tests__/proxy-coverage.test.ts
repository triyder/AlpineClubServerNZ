import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { config } from "@/proxy";
import { isPublicPath, PUBLIC_PAGES } from "@/lib/public-pages";

/**
 * GUARD: every console page is behind the proxy's session gate.
 *
 * `src/proxy.ts` only runs for the paths in its `matcher`, so a page added
 * without a matcher entry is silently ungated at the edge — the page's own
 * `getSession()` check still stands, but the first gate is simply absent, and
 * nothing at runtime says so. `/issues` shipped that way. This lists every page
 * under `src/app` and requires each to be matched, apart from the few that are
 * public on purpose.
 */

const APP_ROOT = join(process.cwd(), "src", "app");

/** Pages that must be reachable without a session (one list, shared with the theme). */
const PUBLIC_PAGE_SET = new Set<string>(PUBLIC_PAGES);

function pageRoutes(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // Route handlers (api) are not pages; they authenticate themselves.
      if (prefix === "" && name === "api") return [];
      return pageRoutes(full, `${prefix}/${name}`);
    }
    return name === "page.tsx" ? [prefix || "/"] : [];
  });
}

function isMatched(route: string): boolean {
  return config.matcher.some((entry) => {
    const base = entry.replace(/\/:path\*$/, "");
    return route === base || route.startsWith(`${base}/`);
  });
}

describe("proxy session gate coverage", () => {
  const routes = pageRoutes(APP_ROOT);

  it("finds the console pages", () => {
    expect(routes).toEqual(expect.arrayContaining(["/dashboard", "/lodges", "/login"]));
  });

  for (const route of routes.filter((r) => !PUBLIC_PAGE_SET.has(r))) {
    it(`${route} is matched by the proxy`, () => {
      expect(
        isMatched(route),
        `${route} is a page but is not in src/proxy.ts (PROTECTED_PREFIXES and config.matcher). Add it to BOTH lists.`,
      ).toBe(true);
    });
  }

  it("no public page is gated, and the console is not treated as public", () => {
    for (const page of PUBLIC_PAGES) expect(isMatched(page), page).toBe(false);
    expect(isPublicPath("/book/go/abc")).toBe(true);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/bookings")).toBe(false);
  });

  it("leaves the public lodge search ungated", () => {
    expect(routes).toContain("/book");
    expect(isMatched("/book")).toBe(false);
    expect(isMatched("/book/go/abc")).toBe(false);
  });

  it("covers the image manager and the issues screen explicitly", () => {
    expect(isMatched("/admin/image-manager")).toBe(true);
    expect(isMatched("/issues")).toBe(true);
  });
});
