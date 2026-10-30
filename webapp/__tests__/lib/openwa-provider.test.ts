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

/**
 * G-WA-1 (open finding, fixed 2026-10-31): OpenWA answers HTTP 400 "Session '…' is not
 * active. Start the session first." while its WhatsApp session is down. That is not a
 * bad recipient: the message must be retried later, not failed for good. A 400 for a
 * real bad request (an unregistered number) stays permanent. fetch is a local stub.
 */
describe("OpenWA adapter — which HTTP answers are retried", () => {
  const saved = { ...process.env };
  let fetchSpy: jest.SpyInstance;
  const answer = (status: number, body: unknown) => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  };

  beforeEach(() => {
    process.env.OPENWA_URL = "http://openwa.invalid";
    process.env.OPENWA_API_KEY = "test-key";
    process.env.OPENWA_SESSION_ID = "test-session";
    process.env.OPENWA_SEND_ALLOWLIST = TEST_PHONE;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    process.env = { ...saved };
  });

  it("G-WA-1: 400 'session is not active' is transient (retried)", async () => {
    answer(400, { statusCode: 400, message: "Session 'test-session' is not active. Start the session first.", error: "Bad Request" });
    const result = await new OpenWAProvider().sendText({ userId: "u1", phone: TEST_PHONE }, "hello");
    expect(result).toEqual({ ok: false, transient: true, error: "OpenWA session is not active (HTTP 400)." });
  });

  it("a 400 for anything else stays permanent", async () => {
    answer(400, { statusCode: 400, message: "The number is not on WhatsApp.", error: "Bad Request" });
    const result = await new OpenWAProvider().sendText({ userId: "u1", phone: TEST_PHONE }, "hello");
    expect(result).toEqual({ ok: false, transient: false, error: "OpenWA returned HTTP 400." });
  });

  it("409, 429 and 5xx stay transient; 201 is a send with its message id", async () => {
    for (const status of [409, 429, 503]) {
      answer(status, { message: "busy" });
      expect((await new OpenWAProvider().sendText({ userId: "u1", phone: TEST_PHONE }, "hello")).transient).toBe(true);
      fetchSpy.mockRestore();
    }
    answer(201, { messageId: "m-1" });
    expect(await new OpenWAProvider().sendText({ userId: "u1", phone: TEST_PHONE }, "hello")).toEqual({ ok: true, providerMessageId: "m-1" });
  });
});
