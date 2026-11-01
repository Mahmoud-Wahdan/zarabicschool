import { z } from "zod";

import { isValidTimeZone } from "./time-zone";

const passwordSchema = z.string().min(12, "Password must be at least 12 characters").max(128);

export const privilegedUserCreateSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(2).max(100),
  password: passwordSchema,
  role: z.enum(["ADMIN", "SUPERVISOR"]),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export const privilegedUserUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().optional().or(z.literal("")).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")).optional(),
  role: z.enum(["ADMIN", "SUPERVISOR"]).optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export const subjectCreateSchema = z.object({
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  descriptionAr: z.string().trim().max(1000).optional().or(z.literal("")),
  descriptionEn: z.string().trim().max(1000).optional().or(z.literal("")),
  icon: z.string().trim().max(80).optional().or(z.literal("")),
  sortOrder: z.number().int().min(0).max(10000).default(0),
});

export const subjectUpdateSchema = subjectCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const accountFields = {
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),

};

/** Student profile create/update: report_language is editable by Admin/Supervisor (Session 1, CONTEXT §9). */
export const reportLanguageSchema = z.enum(["ar", "en", "fr", "de", "tr"]);

export const guardianCreateSchema = z.object({
  ...accountFields,
  relationship: z.enum(["FATHER", "MOTHER"]),
});

export const studentCreateSchema = z.object({
  ...accountFields,
  guardianId: z.guid().nullable().optional(),
  isAdult: z.boolean().default(false),
  enrollmentDate: z.string().date().nullable().optional(),
  reportLanguage: reportLanguageSchema.optional(),
});

/** D9: the Admin adds a teacher WITH a rate; a Supervisor never sends one (route-enforced). */
export const teacherInitialRateSchema = z.object({
  hourlyRateMinor: z.number().int().positive().max(100_000_000),
  currency: z.enum(["EGP", "USD"]),
  effectiveFrom: z.string().datetime({ offset: true }),
});

export const teacherCreateSchema = z.object({ ...accountFields, rate: teacherInitialRateSchema.optional() });

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")).optional(),
  email: z.string().trim().email().optional().or(z.literal("")).optional(),
  isActive: z.boolean().optional(),
  guardianId: z.guid().nullable().optional(),
  relationship: z.enum(["FATHER", "MOTHER"]).optional(),
  // Session 1 (owner, 2026-10-18): the language the teacher writes this student's
  // reports in — editable by Admin/Supervisor on the student profile (CONTEXT §9).
  reportLanguage: reportLanguageSchema.optional(),
  // Phase 7 follow-up (owner, 2026-10-26): "no announcements" — ADMIN only (the
  // route refuses it from a Supervisor).
  announcementsOptOut: z.boolean().optional(),
  // S-03 / D3: the Admin sets a user's IANA zone (validated in the route); never a Supervisor.
  timezone: z.string().trim().min(1).max(80).optional(),
});

export const teacherSubjectSchema = z.object({
  teacherId: z.guid(),
  subjectId: z.guid(),
});

export const assignmentCreateSchema = z.object({
  studentId: z.guid(),
  teacherId: z.guid(),
  subjectId: z.guid(),
});

export const assignmentUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("END"),
    endedReason: z.string().trim().max(1000).optional().or(z.literal("")),
  }),
  z.object({
    action: z.literal("CHANGE_TEACHER"),
    newTeacherId: z.guid(),
    endedReason: z.string().trim().max(1000).optional().or(z.literal("")),
  }),
]);

export const assignmentListSchema = z.object({
  studentId: z.guid().optional(),
  teacherId: z.guid().optional(),
  subjectId: z.guid().optional(),
  status: z.enum(["ACTIVE", "ENDED"]).optional(),
});

export const enrollmentSchema = z.object({
  sessionId: z.guid(),
  studentId: z.guid(),
  assignmentOverrideReason: z.string().trim().min(1).max(1000).optional(),
});

const isoDateTime = z.string().datetime({ offset: true });
const sessionTimeZone = z.string().trim().min(1).max(80).refine(isValidTimeZone, "A valid IANA time zone is required.");

const zoomUrlField = z.string().trim().min(1).max(2000);
const optionalZoomUrlField = z.string().trim().max(2000).optional().or(z.literal(""));

export const sessionCreateSchema = z.object({
  teacherId: z.guid(),
  subjectId: z.guid(),
  sessionType: z.enum(["PRIVATE", "GROUP"]),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  // No "UTC" default (time-zone audit, 2026-10-27): the route falls back to the
  // creator's stored zone. Only a real IANA name is accepted (review 2026-10-29).
  timezone: sessionTimeZone.optional(),
  zoomJoinUrl: zoomUrlField,
  zoomHostUrl: optionalZoomUrlField,
  studentIds: z.array(z.guid()).min(1).max(100),
  assignmentOverrideReason: z.string().trim().min(1).max(1000).optional(),
});

export const recurringSessionSchema = sessionCreateSchema.extend({
  weekCount: z.number().int().min(1).max(52),
});

export const sessionUpdateSchema = z.object({
  scheduledStart: isoDateTime.optional(),
  scheduledEnd: isoDateTime.optional(),
  timezone: sessionTimeZone.optional(),
  zoomJoinUrl: zoomUrlField.optional(),
  zoomHostUrl: optionalZoomUrlField,
  status: z.enum(["SCHEDULED", "CANCELLED"]).optional(),
  cancellationReason: z.string().trim().max(1000).optional().or(z.literal("")),
}).refine((value) => Object.keys(value).length > 0, "At least one update is required.");

// Phase 4 — dedicated per-session / series link editing. The join link is required
// (Sessions.zoom_join_url is NOT NULL); the host link is optional and may be cleared
// with "" or null. Format validation happens with the shared lib/validation/zoom-url.
export const sessionLinkUpdateSchema = z.object({
  zoomJoinUrl: zoomUrlField,
  zoomHostUrl: optionalZoomUrlField,
});

export const replacementSessionSchema = sessionCreateSchema;

export const sessionChangeRequestSchema = z.object({
  reason: z.string().trim().min(2).max(1000),
  proposedChange: z.string().trim().min(2).max(2000),
});

export const changeRequestReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const sessionReportSchema = z.object({
  attendanceOutcome: z.enum(["ATTENDED", "STUDENT_ABSENT"]),
  classRemark: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(2).max(5000),
  // Homework is a required field (CONTEXT §6 teacher experience / §9); empty strings fail.
  homework: z.string().trim().min(1).max(5000),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
  operationalEvents: z.record(z.string(), z.unknown()).optional(),
  extraTimeMinutes: z.number().int().min(0).max(600).default(0),
  // Session 1 (owner, 2026-10-18): the language this report is written in
  // (default = the student's report_language; the teacher can change it per report).
  language: z.enum(["ar", "en", "fr", "de", "tr"]).default("ar"),
});

export const reportReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().trim().min(2).max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "REJECT" && !value.rejectionReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectionReason"], message: "A rejection reason is required." });
  }
});

// ---------------------------------------------------------------------------
// Monthly report (Session 1, owner 2026-10-18 — CONTEXT §9 stream 2; PROPOSAL
// until the owner confirms). No money, no attendance, no approval gate.
// ---------------------------------------------------------------------------

/** `'YYYY-MM'`, e.g. `2026-09`. Lexically comparable; no timezone ambiguity. */
export const monthKeySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM format.");

export const monthlyReportSchema = z.object({
  monthKey: monthKeySchema,
  studentId: z.guid(),
  achievement: z.string().trim().min(2).max(10000),
  learningProgress: z.enum(["EXCELLENT", "VERY_GOOD", "GOOD", "VERY_SLOW_PROGRESS"]),
  classFocus: z.enum(["ALWAYS", "OFTEN", "SOMETIMES", "RARELY"]),
  homeworkCompletion: z.enum(["ALWAYS", "MOST_OF_THE_TIME", "SOMETIMES", "RARELY"]),
  punctuality: z.enum(["ALWAYS", "OFTEN", "SOMETIMES", "RARELY"]),
  supportAreas: z.string().trim().max(5000).optional().or(z.literal("")),
  nextMonthObjectives: z.string().trim().max(5000).optional().or(z.literal("")),
  language: z.enum(["ar", "en", "fr", "de", "tr"]).default("ar"),
});

export const monthlyReportUpdateSchema = z.object({
  achievement: z.string().trim().min(2).max(10000).optional(),
  learningProgress: z.enum(["EXCELLENT", "VERY_GOOD", "GOOD", "VERY_SLOW_PROGRESS"]).optional(),
  classFocus: z.enum(["ALWAYS", "OFTEN", "SOMETIMES", "RARELY"]).optional(),
  homeworkCompletion: z.enum(["ALWAYS", "MOST_OF_THE_TIME", "SOMETIMES", "RARELY"]).optional(),
  punctuality: z.enum(["ALWAYS", "OFTEN", "SOMETIMES", "RARELY"]).optional(),
  supportAreas: z.string().trim().max(5000).optional().or(z.literal("")),
  nextMonthObjectives: z.string().trim().max(5000).optional().or(z.literal("")),
  language: z.enum(["ar", "en", "fr", "de", "tr"]).optional(),
});


/** Class-remark option with a label per report language (Session 1, CONTEXT §9). */
const classRemarkLabelsSchema = z.object({
  ar: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
  fr: z.string().trim().min(1).max(120),
  de: z.string().trim().min(1).max(120),
  tr: z.string().trim().min(1).max(120),
});

export const classRemarksUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9_]+$/, "Slug must be lowercase letters, digits or underscores."),
        labels: classRemarkLabelsSchema,
      }),
    )
    .min(1)
    .max(16),
});
