import { z } from "zod";

import { BOARD_STATUSES, DEFAULT_BOARD_STATUSES } from "../config/schedule-board";

/** Filters of the teacher schedule board (S-16, D91) — shared by the API and the page. */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

export const scheduleBoardQuerySchema = z.object({
  date: ymd.optional(),
  view: z.enum(["day", "week"]).default("day"),
  teacherId: z.guid().optional(),
  studentId: z.guid().optional(),
  status: z
    .string()
    .optional()
    .transform((value) => (value ? [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))] : DEFAULT_BOARD_STATUSES))
    .pipe(z.array(z.enum(BOARD_STATUSES)).min(1).max(BOARD_STATUSES.length)),
});

export type ScheduleBoardFilters = z.infer<typeof scheduleBoardQuerySchema>;
