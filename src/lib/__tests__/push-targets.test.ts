import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import {
  assertPublicDestination,
  isBlockedAddress,
  PushTargetError,
  validatePushUrlShape,
} from "@/lib/push-targets";

/**
 * Push-target validation.
 *
 * This decides where THIS SERVER will send an authenticated request, and the
 * destination is chosen by a remote party. Everything here is therefore a
 * refusal: the failure this module exists to prevent is a club registering
 * `http://169.254.169.254/` and having the server fetch its own cloud
 * credentials, or pointing at an internal host and using the timing to map the
 * network.
 */

describe("validatePushUrlShape", () => {
  it("accepts an ordinary club endpoint", () => {
    expect(validatePushUrlShape("https://club.example.nz/api/push")).toBe(
      "https://club.example.nz/api/push",
    );
  });

  it("refuses plain http", () => {
    // The body carries a signature and member-written content; http would put
    // both on the wire in clear and let anyone on the path forge posts.
    expect(() => validatePushUrlShape("http://club.example.nz/push")).toThrow(
      /https/,
    );
  });

  it("refuses credentials in the URL", () => {
    // https://good.example@evil.test/ is a way to smuggle a different host past
    // a parser that reads left to right.
    expect(() =>
      validatePushUrlShape("https://user:pw@club.example.nz/push"),
    ).toThrow(PushTargetError);
  });

  it.each([
    ["a loopback literal", "https://127.0.0.1/push"],
    ["the cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["a private literal", "https://10.0.0.5/push"],
    ["an IPv6 loopback literal", "https://[::1]/push"],
  ])("refuses %s", (_label, url) => {
    expect(() => validatePushUrlShape(url)).toThrow(PushTargetError);
  });

  it("refuses a non-default port", () => {
    expect(() => validatePushUrlShape("https://club.example.nz:5432/push")).toThrow(
      PushTargetError,
    );
  });

  it("refuses a fragment and an empty value", () => {
    expect(() => validatePushUrlShape("https://club.example.nz/push#x")).toThrow(
      PushTargetError,
    );
    expect(() => validatePushUrlShape("  ")).toThrow(PushTargetError);
  });
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "2404:6800::1"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it("blocks anything that is not an address at all", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("assertPublicDestination", () => {
  it("accepts a hostname that resolves publicly", async () => {
    mocks.lookup.mockResolvedValue([{ address: "203.0.113.10" }]);
    await expect(
      assertPublicDestination("https://club.example.nz/push"),
    ).resolves.toBeUndefined();
  });

  it("refuses a hostname that resolves into the network", async () => {
    // The case the shape check cannot catch: `internal.example.com` is a
    // perfectly ordinary name that resolves to 10.0.0.1.
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.1" }]);
    await expect(
      assertPublicDestination("https://internal.example.nz/push"),
    ).rejects.toThrow(/private network/);
  });

  it("refuses when ANY address is private, not merely all of them", async () => {
    // A host with both records would otherwise pass here and then connect to
    // whichever the resolver happened to return at delivery time.
    mocks.lookup.mockResolvedValue([
      { address: "203.0.113.10" },
      { address: "127.0.0.1" },
    ]);
    await expect(
      assertPublicDestination("https://split.example.nz/push"),
    ).rejects.toThrow(/private network/);
  });

  it("refuses a name that does not resolve at all", async () => {
    mocks.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      assertPublicDestination("https://nowhere.example.nz/push"),
    ).rejects.toThrow(/could not be resolved/);
  });

  it("refuses an empty answer", async () => {
    mocks.lookup.mockResolvedValue([]);
    await expect(
      assertPublicDestination("https://empty.example.nz/push"),
    ).rejects.toThrow(/could not be resolved/);
  });
});
