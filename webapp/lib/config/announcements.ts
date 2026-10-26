/**
 * Announcement settings (owner, 2026-10-26). Named constants so the owner can change
 * them in one place.
 *
 * WhatsApp is sent through the unofficial OpenWA — bursts raise the ban risk
 * (CONTEXT §8), so announcement sends are throttled HARD in the worker:
 *  - a pause of SPACING + random JITTER between two announcement messages;
 *  - at most MAX_PER_BATCH announcement messages per worker tick (60 s);
 *  - at most MAX_PER_HOUR announcement messages per rolling hour.
 * Jobs over a limit simply wait (stay PENDING) for a later tick — nothing is dropped,
 * and announcement jobs are fetched separately so they never delay other kinds.
 */
export const ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS = 3;
export const ANNOUNCEMENT_MAX_EXPIRY_DAYS = 90;
export const ANNOUNCEMENT_SEND_SPACING_MS = 4_000;
export const ANNOUNCEMENT_SEND_JITTER_MS = 3_000;
export const ANNOUNCEMENT_MAX_PER_BATCH = 8;
export const ANNOUNCEMENT_MAX_PER_HOUR = 60;
/**
 * Frequency rule (owner, 2026-10-26): at most this many announcements per academy
 * in any rolling 24 hours (counted from `sent_at`). Enforced server-side under a
 * per-academy lock so two concurrent sends cannot both pass.
 */
export const ANNOUNCEMENT_MAX_PER_DAY = 2;
