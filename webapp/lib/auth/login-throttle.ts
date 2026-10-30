import { clearFailures, isBlocked, recordFailure } from "../rate-limit";
import { normalizeUsername } from "../validation/auth";

/**
 * Login lockout (D90, owner 2026-10-30): 3 wrong passwords block that sign-in for
 * 15 minutes. Keyed so that an attacker cannot lock the real user out from elsewhere:
 * - (username, address): 3 failures in 15 min → blocked 15 min (the owner's rule);
 * - address: 20 failures in 10 min (spraying many usernames) → blocked 10 min;
 * - username from every address: 50 failures in 1 h (a distributed attack) → blocked 15 min.
 * Only failed attempts count; a success clears its (username, address) counter.
 * In memory (single app instance), like the other rate limits.
 */
const MINUTE = 60 * 1000;
const PAIR = { limit: 3, windowMs: 15 * MINUTE, blockMs: 15 * MINUTE };
const ADDRESS = { limit: 20, windowMs: 10 * MINUTE, blockMs: 10 * MINUTE };
const USERNAME = { limit: 50, windowMs: 60 * MINUTE, blockMs: 15 * MINUTE };

const keys = (username: string, ip: string) => {
  const user = normalizeUsername(username);
  return { pair: `login:pair:${user}:${ip}`, address: `login:ip:${ip}`, username: `login:user:${user}` };
};

export function loginBlocked(username: string, ip: string) {
  const key = keys(username, ip);
  return isBlocked(key.pair) || isBlocked(key.address) || isBlocked(key.username);
}

export function recordLoginFailure(username: string, ip: string) {
  const key = keys(username, ip);
  recordFailure(key.pair, PAIR.limit, PAIR.windowMs, PAIR.blockMs);
  recordFailure(key.address, ADDRESS.limit, ADDRESS.windowMs, ADDRESS.blockMs);
  recordFailure(key.username, USERNAME.limit, USERNAME.windowMs, USERNAME.blockMs);
}

export function recordLoginSuccess(username: string, ip: string) {
  clearFailures(keys(username, ip).pair);
}
