import { z } from "zod";

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

export const guardianCreateSchema = z.object({
  ...accountFields,
  relationship: z.enum(["FATHER", "MOTHER"]),
});

export const studentCreateSchema = z.object({
  ...accountFields,
  guardianId: z.string().uuid().nullable().optional(),
  isAdult: z.boolean().default(false),
  enrollmentDate: z.string().date().nullable().optional(),
});

export const teacherCreateSchema = z.object(accountFields);

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal("")).optional(),
  email: z.string().trim().email().optional().or(z.literal("")).optional(),
  isActive: z.boolean().optional(),
  guardianId: z.string().uuid().nullable().optional(),
  relationship: z.enum(["FATHER", "MOTHER"]).optional(),
});

export const teacherSubjectSchema = z.object({
  teacherId: z.string().uuid(),
  subjectId: z.string().uuid(),
});

export const assignmentCreateSchema = z.object({
  studentId: z.string().uuid(),
  teacherId: z.string().uuid(),
  subjectId: z.string().uuid(),
});

export const assignmentUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("END"),
    endedReason: z.string().trim().max(1000).optional().or(z.literal("")),
  }),
  z.object({
    action: z.literal("CHANGE_TEACHER"),
    newTeacherId: z.string().uuid(),
    endedReason: z.string().trim().max(1000).optional().or(z.literal("")),
  }),
]);

export const assignmentListSchema = z.object({
  studentId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "ENDED"]).optional(),
});

export const enrollmentSchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  assignmentOverrideReason: z.string().trim().min(1).max(1000).optional(),
});

const isoDateTime = z.string().datetime({ offset: true });

const zoomUrlField = z.string().trim().min(1).max(2000);
const optionalZoomUrlField = z.string().trim().max(2000).optional().or(z.literal(""));

export const sessionCreateSchema = z.object({
  teacherId: z.string().uuid(),
  subjectId: z.string().uuid(),
  sessionType: z.enum(["PRIVATE", "GROUP"]),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  zoomJoinUrl: zoomUrlField,
  zoomHostUrl: optionalZoomUrlField,
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  assignmentOverrideReason: z.string().trim().min(1).max(1000).optional(),
});

export const recurringSessionSchema = sessionCreateSchema.extend({
  weekCount: z.number().int().min(1).max(52),
});

export const sessionUpdateSchema = z.object({
  scheduledStart: isoDateTime.optional(),
  scheduledEnd: isoDateTime.optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
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
  homework: z.string().trim().max(5000),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
  operationalEvents: z.record(z.string(), z.unknown()).optional(),
  extraTimeMinutes: z.number().int().min(0).max(600).default(0),
});

export const reportReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().trim().min(2).max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "REJECT" && !value.rejectionReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectionReason"], message: "A rejection reason is required." });
  }
});
