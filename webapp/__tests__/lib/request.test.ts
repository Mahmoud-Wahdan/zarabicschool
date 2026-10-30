import { getClientIp, isSameOrigin } from "../../lib/request";

describe("request helpers", () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it("takes the address the trusted proxy added, never one the client forged (G-A07-5)", () => {
    // Client sent "203.0.113.10"; the one proxy appended the address it saw.
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 198.51.100.7",
      "x-real-ip": "198.51.100.5",
    });
    expect(getClientIp(headers)).toBe("198.51.100.7");
    // Whatever the client puts on the left, the bucket stays the same.
    expect(getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 198.51.100.7" }))).toBe("198.51.100.7");
    expect(getClientIp(new Headers({ "x-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("counts TRUSTED_PROXY_HOPS proxies from the right (CDN in front of nginx)", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    // forged, client (added by the CDN), CDN edge (added by nginx)
    expect(getClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.10, 10.0.0.2" }))).toBe("203.0.113.10");
    expect(getClientIp(new Headers({ "x-forwarded-for": "203.0.113.10" }))).toBe("203.0.113.10");
    // Fewer entries than proxies: the RIGHTMOST — the address the nearest proxy saw —
    // never a client-written entry on the left (review 2026-10-29).
    process.env.TRUSTED_PROXY_HOPS = "3";
    expect(getClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.10" }))).toBe("203.0.113.10");
  });

  it("warns once when TRUSTED_PROXY_HOPS is not a whole number from 1 to 5, and uses one proxy", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      process.env.TRUSTED_PROXY_HOPS = "lots";
      expect(getClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.10" }))).toBe("203.0.113.10");
      getClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.10" }));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("TRUSTED_PROXY_HOPS");
      expect(String(warn.mock.calls[0][0])).not.toContain("lots");
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back to x-real-ip and then unknown", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "198.51.100.5" }))).toBe("198.51.100.5");
    expect(getClientIp(new Headers())).toBe("unknown");
  });

  it("requires matching origin and host outside production", () => {
    const matching = new Headers({
      origin: "http://localhost:3000",
      host: "localhost:3000",
    });
    const mismatched = new Headers({
      origin: "http://localhost:3001",
      host: "localhost:3000",
    });

    expect(isSameOrigin(matching)).toBe(true);
    expect(isSameOrigin(mismatched)).toBe(false);
  });
});