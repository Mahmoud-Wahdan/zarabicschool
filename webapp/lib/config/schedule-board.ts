/**
 * Teacher schedule board (S-16, D91): the Admin's daily-hours threshold. A teacher
 * whose scheduled minutes on a day are ABOVE it is highlighted. AcademySettings key
 * `schedule.teacher_daily_hours_threshold`, whole hours 1–16, default 6.
 */
export const TEACHER_HOURS_THRESHOLD_KEY = "schedule.teacher_daily_hours_threshold";
export const DEFAULT_TEACHER_HOURS_THRESHOLD = 6;
export const MIN_TEACHER_HOURS_THRESHOLD = 1;
export const MAX_TEACHER_HOURS_THRESHOLD = 16;

/** Statuses the board can show; only SCHEDULED and COMPLETED count in the totals. */
export const BOARD_STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "MISSED"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const DEFAULT_BOARD_STATUSES: BoardStatus[] = ["SCHEDULED", "COMPLETED"];
export const COUNTED_BOARD_STATUSES: BoardStatus[] = ["SCHEDULED", "COMPLETED"];
