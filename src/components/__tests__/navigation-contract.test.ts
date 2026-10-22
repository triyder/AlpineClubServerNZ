import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
  The console's navigation and the guest header are server components the
  node test environment cannot render, so their contract (#32) is pinned from
  the source: which labels and hrefs each header carries, and where "Register a
  lodge" lives.
*/
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const shell = read("src/components/console-shell.tsx");
const guest = read("src/components/book/public-header.tsx");
const connections = read("src/app/clubs/page.tsx");

describe("console navigation (#32)", () => {
  it("names the clubs page Connections and keeps its route at /clubs", () => {
    expect(shell).toMatch(/href="\/clubs"[\s\S]{0,80}Connections/);
    expect(shell).not.toMatch(/>\s*Clubs\s*</);
  });

  it("gathers Settings, Audit, Issues and Images under one Admin menu", () => {
    const menuStart = shell.indexOf("<details");
    const menuEnd = shell.indexOf("</details>");
    expect(menuStart).toBeGreaterThan(0);
    const menu = shell.slice(menuStart, menuEnd);
    expect(menu).toMatch(/>\s*Admin\s*</);
    for (const href of ["/settings", "/audit", "/issues", "/admin/image-manager"]) {
      expect(menu).toContain(`href="${href}"`);
    }
    // None of the four is also a top-level peer.
    const top = shell.slice(0, menuStart);
    for (const href of ["/settings", "/audit", "/issues", "/admin/image-manager"]) {
      expect(top).not.toContain(`href="${href}"`);
    }
  });

  it("moves Register a lodge from the guest header to the top of Connections", () => {
    expect(guest).not.toContain("Register a lodge");
    expect(guest).not.toContain('href: "/register"');
    expect(connections).toContain("Register a lodge");
    expect(connections).toContain('href="/register"');
  });
});
