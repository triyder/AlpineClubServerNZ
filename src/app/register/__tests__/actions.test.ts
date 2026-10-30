import { describe, it, expect, vi, beforeEach } from "vitest";

const registerClub = vi.fn();
const issueClubToken = vi.fn();
const recordAudit = vi.fn();
vi.mock("@/lib/clubs", () => ({
  registerClub: (...a: unknown[]) => registerClub(...a),
  REGISTER_PER_WINDOW: 5,
  REGISTER_WINDOW_MS: 3_600_000,
}));
let callerIp = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": callerIp }),
}));
vi.mock("@/lib/issue-club-token", () => ({
  issueClubToken: (...a: unknown[]) => issueClubToken(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const notifyNewClub = vi.fn();
vi.mock("@/lib/club-notify", () => ({
  notifyNewClub: (...a: unknown[]) => notifyNewClub(...a),
}));

import { registerAction } from "../actions";
import { resetRateLimits } from "@/lib/rate-limit";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return fd;
}

const VALID = {
  name: "Ruapehu Lodge",
  code: "RUAPEHU",
  location: "Mt Ruapehu",
  contactEmail: "contact@ruapehu.nz",
};

describe("registerAction (#30): the club gets its first key on the spot", () => {
  beforeEach(() => {
    resetRateLimits();
    callerIp = "203.0.113.1";
    registerClub.mockReset();
    issueClubToken.mockReset();
    recordAudit.mockReset();
    notifyNewClub.mockReset();
    notifyNewClub.mockResolvedValue({ sent: true, to: ["admin@example.nz"] });
    issueClubToken.mockResolvedValue({
      id: "tok-1",
      name: "Default key",
      prefix: "acs_0123abcd",
      scopes: ["sync:read"],
      plaintext: "acs_0123abcd_" + "f".repeat(40),
    });
  });

  it("issues a key for a NEWLY created club and returns the plaintext once", async () => {
    registerClub.mockResolvedValue({
      ok: true,
      created: true,
      club: { id: "club-1", code: "RUAPEHU", status: "PENDING" },
    });

    const state = await registerAction({}, form(VALID));

    expect(state).toEqual({
      success: true,
      created: true,
      apiKey: "acs_0123abcd_" + "f".repeat(40),
      keyPrefix: "acs_0123abcd",
    });
    expect(issueClubToken).toHaveBeenCalledWith({ clubId: "club-1", source: "register" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "club.register", clubId: "club-1" }),
    );
    // The administrators are told, once.
    expect(notifyNewClub).toHaveBeenCalledTimes(1);
    expect(notifyNewClub).toHaveBeenCalledWith("club-1", "web");
  });

  it("still answers when the administrators' mail cannot be sent", async () => {
    registerClub.mockResolvedValue({
      ok: true,
      created: true,
      club: { id: "club-1", code: "RUAPEHU", status: "PENDING" },
    });
    // Never resolves: the registration must not wait on the SMTP server.
    notifyNewClub.mockReturnValue(new Promise(() => {}));

    const state = await registerAction({}, form(VALID));
    expect(state).toMatchObject({ success: true, created: true });
  });

  it("passes every ticked lodge and the note through to the write (#40), and none when none was ticked", async () => {
    registerClub.mockResolvedValue({
      ok: true,
      created: true,
      club: { id: "club-1", code: "RUAPEHU", status: "PENDING" },
    });

    await registerAction({}, form({ ...VALID, lodgeIds: ["lodge-a", "lodge-b"], notes: " not listed: Tukino " }));
    expect(registerClub).toHaveBeenLastCalledWith(
      expect.objectContaining({ lodgeIds: ["lodge-a", "lodge-b"], notes: "not listed: Tukino" }),
    );

    await registerAction({}, form(VALID));
    expect(registerClub).toHaveBeenLastCalledWith(
      expect.objectContaining({ lodgeIds: [], notes: undefined }),
    );
  });
  it("issues NO key when the code already belongs to a club, so a code alone cannot mint one", async () => {
    registerClub.mockResolvedValue({
      ok: true,
      created: false,
      club: { id: "club-1", code: "RUAPEHU", status: "APPROVED" },
    });

    const state = await registerAction({}, form(VALID));

    expect(state).toEqual({ success: true, created: false });
    expect(issueClubToken).not.toHaveBeenCalled();
    expect(notifyNewClub).not.toHaveBeenCalled();
  });

  it("issues nothing on a validation or registration failure", async () => {
    const invalid = await registerAction({}, form({ ...VALID, contactEmail: "not-an-email" }));
    expect(invalid.success).toBeUndefined();
    expect(invalid.error).toBeTruthy();

    registerClub.mockResolvedValue({ ok: false, error: "Could not register club." });
    const failed = await registerAction({}, form(VALID));
    expect(failed).toEqual({ error: "Could not register club." });

    expect(issueClubToken).not.toHaveBeenCalled();
  });

  it("creates nothing when the hidden honeypot field is filled, answering as for an existing code", async () => {
    const state = await registerAction({}, form({ ...VALID, website: "http://spam.example" }));
    expect(state).toEqual({ success: true, created: false });
    expect(registerClub).not.toHaveBeenCalled();
    expect(issueClubToken).not.toHaveBeenCalled();
    expect(notifyNewClub).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "FAILURE", metadata: expect.objectContaining({ reason: "honeypot" }) }),
    );
  });

  it("refuses a sixth registration from one address within the hour, creating nothing", async () => {
    registerClub.mockResolvedValue({
      ok: true,
      created: true,
      club: { id: "club-1", code: "RUAPEHU", status: "PENDING" },
    });
    for (let i = 0; i < 5; i++) {
      await registerAction({}, form({ ...VALID, code: `CLUB${i}` }));
    }
    registerClub.mockClear();
    issueClubToken.mockClear();

    const state = await registerAction({}, form({ ...VALID, code: "CLUB6" }));
    expect(state.error).toMatch(/Too many registrations/);
    expect(registerClub).not.toHaveBeenCalled();
    expect(issueClubToken).not.toHaveBeenCalled();

    // Another address is unaffected.
    callerIp = "198.51.100.9";
    expect((await registerAction({}, form({ ...VALID, code: "CLUB7" }))).success).toBe(true);
  });
});
