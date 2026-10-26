import { OpenWAProvider } from "../../lib/messaging/openwa-provider";

/**
 * The real OpenWA adapter's refusal paths (Phase 8). Every case must answer BEFORE
 * any network call, so `fetch` is replaced by a spy that fails the test if called —
 * no test ever reaches OpenWA (owner, 2026-10-26). Uses a reserved fake number.
 */
const TEST_PHONE = "+201000009999";
const ENV_KEYS = ["OPENWA_URL", "OPENWA_API_KEY", "OPENWA_SESSION_ID", "OPENWA_SEND_ALLOWLIST"] as const;

describe("OpenWA adapter — refusal paths never touch the network", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch must not be called by these tests");
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("refuses a recipient without a phone", async () => {
    const result = await new OpenWAProvider().sendText({ userId: "u1", phone: null }, "hello");
    expect(result).toEqual({ ok: false, error: "Recipient has no phone number." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a number outside OPENWA_SEND_ALLOWLIST outside production", async () => {
    process.env.OPENWA_SEND_ALLOWLIST = "";
    const result = await new OpenWAProvider().sendText({ userId: "u1", phone: TEST_PHONE }, "hello");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Recipient blocked by OPENWA_SEND_ALLOWLIST (non-production).");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 'OpenWA is not configured.' (permanent) when the config is missing", async () => {
    process.env.OPENWA_SEND_ALLOWLIST = TEST_PHONE;
    delete process.env.OPENWA_URL;
    delete process.env.OPENWA_API_KEY;
    delete process.env.OPENWA_SESSION_ID;
    const result = await new OpenWAProvider().sendText({ userId: "u1", phone: TEST_PHONE }, "hello");
    expect(result).toEqual({ ok: false, error: "OpenWA is not configured." });
    expect(result.transient).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
