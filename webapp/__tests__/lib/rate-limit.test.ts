import { allowRequest, rateLimitBucketCount, resetRateLimits } from "../../lib/rate-limit";

/**
 * Low item (review 2026-10-29): the in-memory store must not keep a bucket per key
 * forever. Expired buckets are removed, so login attempts with random usernames or
 * many client addresses cannot grow memory without bound.
 */
describe("in-memory rate limit store", () => {
  beforeEach(() => {
    resetRateLimits();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-29T10:00:00Z"));
  });
  afterEach(() => jest.useRealTimers());

  it("RL-01: limits within the window and allows again after it", () => {
    for (let i = 0; i < 3; i += 1) expect(allowRequest("k", 3, 60_000)).toBe(true);
    expect(allowRequest("k", 3, 60_000)).toBe(false);
    jest.setSystemTime(new Date("2026-10-29T10:01:00Z"));
    expect(allowRequest("k", 3, 60_000)).toBe(true);
  });

  it("RL-02: expired buckets are removed instead of piling up", () => {
    for (let i = 0; i < 5_000; i += 1) allowRequest(`login:user:random-${i}`, 5, 60_000);
    expect(rateLimitBucketCount()).toBe(5_000);
    jest.setSystemTime(new Date("2026-10-29T10:10:00Z"));
    allowRequest("someone-new", 5, 60_000);
    expect(rateLimitBucketCount()).toBe(1);
  });

  it("RL-03: live buckets survive the cleanup", () => {
    allowRequest("short", 1, 60_000);
    allowRequest("long", 1, 60 * 60_000);
    jest.setSystemTime(new Date("2026-10-29T10:05:00Z"));
    allowRequest("other", 1, 60_000);
    expect(allowRequest("long", 1, 60 * 60_000)).toBe(false);
    expect(allowRequest("short", 1, 60_000)).toBe(true);
  });
});
