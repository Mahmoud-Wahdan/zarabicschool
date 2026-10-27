import { devAllowedOrigins } from "../../lib/config/dev-origins";

/**
 * M-3 (second review, owner 2026-10-27): the dev tunnel host is no longer
 * hard-coded in next.config.ts; it is the host of APP_PUBLIC_URL (the one .env line
 * the owner sets to the ngrok URL).
 */
describe("devAllowedOrigins (DEV-01)", () => {
  it("returns the APP_PUBLIC_URL host, nothing when unset or not a URL", () => {
    expect(devAllowedOrigins({ APP_PUBLIC_URL: "https://abc-123.ngrok-free.dev" })).toEqual(["abc-123.ngrok-free.dev"]);
    expect(devAllowedOrigins({ APP_PUBLIC_URL: " https://abc.ngrok-free.dev/path?x=1 " })).toEqual(["abc.ngrok-free.dev"]);
    expect(devAllowedOrigins({})).toEqual([]);
    expect(devAllowedOrigins({ APP_PUBLIC_URL: "not a url" })).toEqual([]);
    expect(devAllowedOrigins({ APP_PUBLIC_URL: "ftp://files.example" })).toEqual([]);
  });

  it("does not add localhost (Next allows it already)", () => {
    expect(devAllowedOrigins({ APP_PUBLIC_URL: "http://localhost:3000" })).toEqual([]);
  });
});
