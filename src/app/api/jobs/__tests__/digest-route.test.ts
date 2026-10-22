import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runAdminDigest = vi.fn();
vi.mock("@/lib/admin-digest", () => ({
  runAdminDigest: (...a: unknown[]) => runAdminDigest(...a),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { POST } from "@/app/api/jobs/digest/route";

const SECRET = "job-secret-0123456789abcdef0123456789abcdef";
const req = (secret?: string) =>
  new Request("https://s/api/jobs/digest", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-job-secret": secret },
  });

describe("POST /api/jobs/digest (#34)", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.JOB_SECRET;
    process.env.JOB_SECRET = SECRET;
    runAdminDigest.mockReset();
    runAdminDigest.mockResolvedValue({ ran: true, sent: false, reason: "nothing-new" });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.JOB_SECRET;
    else process.env.JOB_SECRET = saved;
  });

  it("runs the digest for the host's cron when the secret matches", async () => {
    const res = await POST(req(SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ran: true, sent: false, reason: "nothing-new" });
    expect(runAdminDigest).toHaveBeenCalledTimes(1);
  });

  it("answers the same 401 to a wrong, missing or unset secret, and runs nothing", async () => {
    expect((await POST(req("wrong"))).status).toBe(401);
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req(SECRET + "x"))).status).toBe(401);
    delete process.env.JOB_SECRET;
    expect((await POST(req(SECRET))).status).toBe(401);
    process.env.JOB_SECRET = "short";
    expect((await POST(req("short"))).status).toBe(401);
    expect(runAdminDigest).not.toHaveBeenCalled();
  });

  it("answers 409 while another run holds the claim, and 502 with the provider's words when the send fails", async () => {
    runAdminDigest.mockResolvedValue({ ran: false, reason: "claimed" });
    expect((await POST(req(SECRET))).status).toBe(409);

    runAdminDigest.mockRejectedValue(new Error("535 Authentication credentials invalid"));
    const failed = await POST(req(SECRET));
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("535 Authentication credentials invalid");
  });
});
