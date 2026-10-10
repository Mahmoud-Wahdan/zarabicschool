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

export const enrollmentSchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
});

const isoDateTime = z.string().datetime({ offset: true });

const httpsZoomUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://"), "Zoom links must use https.");

export const sessionCreateSchema = z.object({
  teacherId: z.string().uuid(),
  subjectId: z.string().uuid(),
  sessionType: z.enum(["PRIVATE", "GROUP"]),
  scheduledStart: isoDateTime,
  scheduledEnd: isoDateTime,
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  zoomJoinUrl: httpsZoomUrl,
  zoomHostUrl: httpsZoomUrl.optional().or(z.literal("")),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
});

export const recurringSessionSchema = sessionCreateSchema.extend({
  weekCount: z.number().int().min(1).max(52),
});

export const sessionUpdateSchema = z.object({
  scheduledStart: isoDateTime.optional(),
  scheduledEnd: isoDateTime.optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  zoomJoinUrl: httpsZoomUrl.optional(),
  zoomHostUrl: httpsZoomUrl.optional().or(z.literal("")),
  status: z.enum(["SCHEDULED", "CANCELLED"]).optional(),
  cancellationReason: z.string().trim().max(1000).optional().or(z.literal("")),
}).refine((value) => Object.keys(value).length > 0, "At least one update is required.");

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
