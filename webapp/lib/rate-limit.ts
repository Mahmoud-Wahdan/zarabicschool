type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Expired buckets are swept at most this often (review 2026-10-29: the store never shrank). */
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweepAt = 0;

function sweepExpired(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function allowRequest(key: string, limit = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  sweepExpired(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/**
 * Failure counters with a block (D90, login): `limit` failures inside `windowMs`
 * block the key for `blockMs` from the last failure. Only failures are counted.
 */
type FailureBucket = { count: number; windowEndsAt: number; blockedUntil: number };
const failures = new Map<string, FailureBucket>();

function sweepFailures(now: number) {
  for (const [key, bucket] of failures) {
    if (bucket.windowEndsAt <= now && bucket.blockedUntil <= now) failures.delete(key);
  }
}

export function recordFailure(key: string, limit: number, windowMs: number, blockMs: number) {
  const now = Date.now();
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    sweepExpired(now);
    sweepFailures(now);
  }
  const current = failures.get(key);
  const bucket = !current || current.windowEndsAt <= now
    ? { count: 0, windowEndsAt: now + windowMs, blockedUntil: current?.blockedUntil ?? 0 }
    : current;
  bucket.count += 1;
  if (bucket.count >= limit) bucket.blockedUntil = now + blockMs;
  failures.set(key, bucket);
}

export function isBlocked(key: string) {
  const bucket = failures.get(key);
  return bucket !== undefined && bucket.blockedUntil > Date.now();
}

export function clearFailures(key: string) {
  failures.delete(key);
}

export function resetRateLimits() {
  buckets.clear();
  failures.clear();
  lastSweepAt = 0;
}

/** Number of live buckets (tests and diagnostics only; no keys are exposed). */
export function rateLimitBucketCount() {
  return buckets.size;
}
