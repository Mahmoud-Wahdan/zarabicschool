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

export function resetRateLimits() {
  buckets.clear();
  lastSweepAt = 0;
}

/** Number of live buckets (tests and diagnostics only; no keys are exposed). */
export function rateLimitBucketCount() {
  return buckets.size;
}
