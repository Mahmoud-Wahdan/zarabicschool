import { consoleProvider } from "../../lib/messaging/console-provider";
import { openWaProvider } from "../../lib/messaging/openwa-provider";
import { platformBaseUrl, sessionJoinPlatformUrl } from "../../lib/config/platform-url";

/**
 * Console provider + provider selection + public URL (owner-approved, 2026-10-26).
 * The suite-wide fake replaces getMessagingProvider, so the REAL selector is loaded
 * with jest.requireActual here.
 */
const env = process.env as Record<string, string | undefined>;
const KEYS = ["NODE_ENV", "MESSAGING_PROVIDER", "APP_PUBLIC_URL", "NEXTAUTH_URL"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function realSelector() {
  return jest.requireActual<typeof import("../../lib/messaging/provider")>("../../lib/messaging/provider").getMessagingProvider;
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = env[key];
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  jest.restoreAllMocks();
});

describe("provider selection", () => {
  it("MSG-01: MESSAGING_PROVIDER=console selects the console provider outside production", () => {
    env.NODE_ENV = "development";
    env.MESSAGING_PROVIDER = "console";
    expect(realSelector()()).toBe(consoleProvider);
  });

  it("MSG-02: production ALWAYS uses OpenWA, whatever MESSAGING_PROVIDER says", () => {
    env.NODE_ENV = "production";
    env.MESSAGING_PROVIDER = "console";
    expect(realSelector()()).toBe(openWaProvider);
  });

  it("MSG-03: unset or unknown values select OpenWA", () => {
    env.NODE_ENV = "development";
    delete env.MESSAGING_PROVIDER;
    expect(realSelector()()).toBe(openWaProvider);
    env.MESSAGING_PROVIDER = "fake";
    expect(realSelector()()).toBe(openWaProvider);
  });
});

describe("console provider — logs ids and lengths only", () => {
  it("MSG-04: a text send is 'delivered' and the log never contains the text or the phone number", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await consoleProvider.sendText({ userId: "user-123", phone: "+201000000555" }, "سري للغاية — secret message body");
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toMatch(/^console-/);
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).toContain("user-123");
    expect(logged).not.toContain("secret message body");
    expect(logged).not.toContain("سري");
    expect(logged).not.toContain("201000000555");
  });

  it("MSG-05: credentials are never logged (username/password)", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await consoleProvider.sendCredentials(
      { userId: "user-9", phone: "+201000000556" },
      { username: "demo_test_someone", tempPassword: "Very-Secret-Pass-1!" },
    );
    expect(result.ok).toBe(true);
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).not.toContain("demo_test_someone");
    expect(logged).not.toContain("Very-Secret-Pass-1!");
  });

  it("MSG-06: a recipient without a phone fails like the real adapter", async () => {
    expect(await consoleProvider.sendText({ userId: "u", phone: null }, "x")).toEqual({ ok: false, error: "Recipient has no phone number." });
  });
});

describe("public URL for message links (APP_PUBLIC_URL)", () => {
  it("URL-01: APP_PUBLIC_URL wins over NEXTAUTH_URL and only its origin is used", () => {
    env.APP_PUBLIC_URL = "https://academy.example/some/path?x=1";
    env.NEXTAUTH_URL = "http://localhost:3000";
    expect(platformBaseUrl()).toBe("https://academy.example");
    expect(sessionJoinPlatformUrl("abc")).toBe("https://academy.example/api/sessions/abc/join");
  });

  it("URL-02: falls back to NEXTAUTH_URL; an unusable value is skipped; nothing set → no link", () => {
    env.APP_PUBLIC_URL = "not a url";
    env.NEXTAUTH_URL = "http://localhost:3000";
    expect(platformBaseUrl()).toBe("http://localhost:3000");
    env.APP_PUBLIC_URL = "javascript:alert(1)";
    expect(platformBaseUrl()).toBe("http://localhost:3000");
    delete env.APP_PUBLIC_URL;
    delete env.NEXTAUTH_URL;
    expect(platformBaseUrl()).toBeNull();
    expect(sessionJoinPlatformUrl("abc")).toBeNull();
  });
});
