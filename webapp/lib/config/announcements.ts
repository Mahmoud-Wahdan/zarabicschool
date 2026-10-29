/**
 * Announcement settings (owner, 2026-10-26). Named constants so the owner can change
 * them in one place.
 *
 * WhatsApp is sent through the unofficial OpenWA — bursts raise the ban risk
<<<<<<< HEAD
 * (CONTEXT §8), so announcement sends are throttled HARD:
 *  - at least SPACING + random JITTER between two announcement messages — each job
 *    gets its own staggered eligible time when it is queued (review #3, 2026-10-27:
 *    the worker never sleeps for announcements, so they never delay other jobs);
 *  - at most SENDS_PER_TICK announcement messages per worker tick (60 s), sent after
 *    every other kind; MAX_PER_BATCH stays the hard per-tick ceiling;
 *  - at most MAX_PER_HOUR announcement messages per rolling hour.
 * Jobs over a limit simply wait (stay PENDING) for a later tick — nothing is dropped.
=======
 * (CONTEXT §8), so announcement sends are throttled HARD in the worker:
 *  - a pause of SPACING + random JITTER between two announcement messages;
 *  - at most MAX_PER_BATCH announcement messages per worker tick (60 s);
 *  - at most MAX_PER_HOUR announcement messages per rolling hour.
 * Jobs over a limit simply wait (stay PENDING) for a later tick — nothing is dropped,
 * and announcement jobs are fetched separately so they never delay other kinds.
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
 */
export const ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS = 3;
export const ANNOUNCEMENT_MAX_EXPIRY_DAYS = 90;
export const ANNOUNCEMENT_SEND_SPACING_MS = 4_000;
export const ANNOUNCEMENT_SEND_JITTER_MS = 3_000;
export const ANNOUNCEMENT_MAX_PER_BATCH = 8;
<<<<<<< HEAD
export const ANNOUNCEMENT_SENDS_PER_TICK = 1;
export const ANNOUNCEMENT_MAX_PER_HOUR = 60;
/**
 * Frequency rule (owner, 2026-10-26): at most this many announcements per academy
 * in any rolling 24 hours (counted from `sent_at`). Enforced server-side under a
 * per-academy lock so two concurrent sends cannot both pass.
 */
export const ANNOUNCEMENT_MAX_PER_DAY = 2;
/** Technical repeat cap per author: at most 5 ACCEPTED announcements per hour (refused attempts never count). */
export const ANNOUNCEMENT_MAX_PER_AUTHOR_PER_HOUR = 5;
=======
export const ANNOUNCEMENT_MAX_PER_HOUR = 60;
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
