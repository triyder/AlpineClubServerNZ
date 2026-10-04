import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { config } from "@/proxy";

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

/** Pages that must be reachable without a session. */
const PUBLIC_PAGES = new Set(["/", "/login", "/register"]);

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

  for (const route of routes.filter((r) => !PUBLIC_PAGES.has(r))) {
    it(`${route} is matched by the proxy`, () => {
      expect(
        isMatched(route),
        `${route} is a page but is not in src/proxy.ts (PROTECTED_PREFIXES and config.matcher). Add it to BOTH lists.`,
      ).toBe(true);
    });
  }

  it("covers the image manager and the issues screen explicitly", () => {
    expect(isMatched("/admin/image-manager")).toBe(true);
    expect(isMatched("/issues")).toBe(true);
  });
});
