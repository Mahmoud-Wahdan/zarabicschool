import { loginBlocked, recordLoginFailure, recordLoginSuccess } from "../../lib/auth/login-throttle";
import { resetRateLimits } from "../../lib/rate-limit";

/**
 * D90 (owner, 2026-10-30): 3 wrong passwords block that sign-in for 15 minutes.
 * Only failed attempts count; a success clears its (username, address) counter; an
 * attacker elsewhere cannot lock the real user out; an address spraying usernames
 * and a distributed attack on one username are stopped too.
 */
describe("login throttle", () => {
  const A = "203.0.113.10";
  const B = "198.51.100.20";
  beforeEach(() => {
    resetRateLimits();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-30T10:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("LT-01: 3 failures for one username from one address block it; another address is not blocked", () => {
    for (let i = 0; i < 2; i += 1) recordLoginFailure("teacher1", A);
    expect(loginBlocked("teacher1", A)).toBe(false);
    recordLoginFailure("teacher1", A);
    expect(loginBlocked("teacher1", A)).toBe(true);
    expect(loginBlocked("teacher1", B)).toBe(false);
  });

  it("LT-02: the block lasts 15 minutes", () => {
    for (let i = 0; i < 3; i += 1) recordLoginFailure("teacher1", A);
    jest.setSystemTime(new Date("2026-10-30T10:14:59Z"));
    expect(loginBlocked("teacher1", A)).toBe(true);
    jest.setSystemTime(new Date("2026-10-30T10:15:01Z"));
    expect(loginBlocked("teacher1", A)).toBe(false);
  });

  it("LT-03: a successful sign-in clears the counter, so earlier failures do not add up", () => {
    for (let i = 0; i < 2; i += 1) recordLoginFailure("teacher1", A);
    recordLoginSuccess("teacher1", A);
    for (let i = 0; i < 2; i += 1) recordLoginFailure("teacher1", A);
    expect(loginBlocked("teacher1", A)).toBe(false);
  });

  it("LT-04: one address failing on 20 different usernames is blocked for every username", () => {
    for (let i = 0; i < 20; i += 1) recordLoginFailure(`user${i}`, A);
    expect(loginBlocked("someone-else", A)).toBe(true);
    expect(loginBlocked("someone-else", B)).toBe(false);
  });

  it("LT-05: 50 failures on one username from many addresses block that username everywhere for 15 minutes", () => {
    for (let i = 0; i < 50; i += 1) recordLoginFailure("teacher1", `100.64.0.${i + 1}`);
    expect(loginBlocked("teacher1", B)).toBe(true);
    expect(loginBlocked("teacher2", B)).toBe(false);
    jest.setSystemTime(new Date("2026-10-30T10:15:01Z"));
    expect(loginBlocked("teacher1", B)).toBe(false);
  });

  it("LT-06: usernames are compared case-insensitively", () => {
    for (let i = 0; i < 3; i += 1) recordLoginFailure("Teacher1", A);
    expect(loginBlocked("teacher1", A)).toBe(true);
  });
});
