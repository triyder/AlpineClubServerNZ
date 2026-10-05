import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * CENSUS: every data-moving `/api/v1` handler runs the version gate.
 *
 * `enforceClientApiVersion` is what stops a club on a different API version
 * transferring anything. A new route that forgot to call it would quietly let
 * mismatched clubs through — and nothing at runtime would say so, because the
 * gate only acts on a request that reaches it. So this counts, per file, the
 * exported HTTP handlers against the gate calls.
 *
 * Exempt, on purpose: `clubs/register` (called before a club has a token, so
 * there is no club to hold a version against) and `version` (it IS the check,
 * and must answer a mismatched club with the number it asked for).
 */

const V1_ROOT = join(process.cwd(), "src", "app", "api", "v1");
const EXEMPT = new Set(["/clubs/register", "/version"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : routeFiles(full);
    }
    return name === "route.ts" ? [full] : [];
  });
}

describe("version gate census", () => {
  const files = routeFiles(V1_ROOT).map((file) => ({
    file,
    path: file
      .slice(V1_ROOT.length)
      .replace(/\\/g, "/")
      .replace(/\/route\.ts$/, ""),
    source: readFileSync(file, "utf8"),
  }));

  it("finds the v1 routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  for (const { path, source } of files.filter((f) => !EXEMPT.has(f.path))) {
    it(`${path}: every handler calls enforceClientApiVersion after authenticating`, () => {
      const handlers = [
        ...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g),
      ].length;
      const authCalls = [...source.matchAll(/await authenticateApiRequest\(req\)/g)].length;
      const gateCalls = [...source.matchAll(/await enforceClientApiVersion\(req, auth\.client\)/g)]
        .length;
      // Calling the gate is not enough: its RESULT is the refusal, and a
      // handler that dropped it would carry on exactly as if the club matched.
      const refusalReturns = [
        ...source.matchAll(/if \(versionRefusal\) return versionRefusal;/g),
      ].length;
      expect(handlers).toBeGreaterThan(0);
      expect(
        gateCalls,
        `${path} has ${handlers} handler(s) but ${gateCalls} version-gate call(s). A mismatched club would transfer data through the ungated one — add enforceClientApiVersion straight after authentication.`,
      ).toBe(handlers);
      expect(gateCalls).toBe(authCalls);
      expect(
        refusalReturns,
        `${path} calls the gate ${gateCalls} time(s) but returns its refusal ${refusalReturns} time(s). Write it as \`const versionRefusal = await enforceClientApiVersion(req, auth.client); if (versionRefusal) return versionRefusal;\` so the 409 actually leaves the handler.`,
      ).toBe(handlers);
    });
  }
});
