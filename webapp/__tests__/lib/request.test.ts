import { getClientIp, isSameOrigin } from "../../lib/request";

describe("request helpers", () => {
  it("prefers the first forwarded client IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      "x-real-ip": "198.51.100.5",
    });

    expect(getClientIp(headers)).toBe("203.0.113.10");
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