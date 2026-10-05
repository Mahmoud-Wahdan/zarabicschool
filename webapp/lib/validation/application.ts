import { z } from "zod";

export const egyptPhoneRegex = /^(?:\+20|0020|0)?1[0125]\d{8}$/;

export function normalizeEgyptPhone(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  if (compact.startsWith("+20")) return compact;
  if (compact.startsWith("0020")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return `+20${compact.slice(1)}`;
  return `+20${compact}`;
}

export function calculateAge(dateOfBirthStr: string, relativeTo = new Date()): number {
  const birthDate = new Date(`${dateOfBirthStr}T00:00:00Z`);
  if (isNaN(birthDate.getTime())) return 0;
  let age = relativeTo.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = relativeTo.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = relativeTo.getUTCDate() - birthDate.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age;
}

const commonFields = {
  full_name: z.string().trim().min(2, "Name must be at least 2 characters").max(100, "Name cannot exceed 100 characters"),
  phone_whatsapp: z
    .string()
    .trim()
    .refine((val) => egyptPhoneRegex.test(val.replace(/[\s()-]/g, "")), {
      message: "Invalid Egyptian WhatsApp number (e.g. 01012345678 or +201012345678)",
    }),
  email: z.string().trim().email("Invalid email address").optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(100).default("Africa/Cairo"),
  preferred_language: z.enum(["ar", "en"]).default("ar"),
  notes: z.string().trim().max(1000, "Notes cannot exceed 1000 characters").optional(),
  honeypot: z.string().max(0, "Invalid submission").optional(),
};

function createSubjectSchema(allowedSubjects?: string[]) {
  const base = z.string().trim().min(1, "Subject is required");
  if (!allowedSubjects || allowedSubjects.length === 0) {
    return base;
  }
  const allowedSet = new Set(allowedSubjects);
  return base.refine((s) => allowedSet.has(s), {
    message: "Selected subject is not recognized",
  });
}

function buildGuardianFields(allowedSubjects?: string[]) {
  const subjectSchema = createSubjectSchema(allowedSubjects);
  const childSchema = z.object({
    name: z.string().trim().min(2, "Child name must be at least 2 characters").max(100),
    age: z
      .number()
      .int("Age must be a whole number")
      .min(3, "Child age must be at least 3")
      .max(25, "Child age cannot exceed 25"),
    subjects: z.array(subjectSchema).min(1, "Select at least one subject for each child"),
  });

  return {
    ...commonFields,
    children: z.array(childSchema).min(1, "Please add at least one child").max(10, "Maximum 10 children per application"),
    preferred_times: z.string().trim().max(1000, "Preferred times cannot exceed 1000 characters").optional(),
  };
}

function buildStudentFields(allowedSubjects?: string[]) {
  const subjectSchema = createSubjectSchema(allowedSubjects);
  return {
    ...commonFields,
    date_of_birth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD")
      .refine((val) => !isNaN(Date.parse(val)), "Invalid date of birth"),
    subjects: z.array(subjectSchema).min(1, "Select at least one subject"),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    preferred_times: z.string().trim().max(1000, "Preferred times cannot exceed 1000 characters").optional(),
    guardian_name: z.string().trim().max(100).optional(),
    guardian_phone: z.string().trim().optional(),
    guardian_relationship: z.enum(["father", "mother"]).optional(),
  };
}

function buildTeacherFields(allowedSubjects?: string[]) {
  const subjectSchema = createSubjectSchema(allowedSubjects);
  return {
    ...commonFields,
    subjects: z.array(subjectSchema).min(1, "Select at least one subject to teach"),
    years_experience: z
      .number()
      .int("Experience must be a whole number")
      .min(0, "Experience cannot be negative")
      .max(50, "Experience cannot exceed 50 years"),
    qualifications: z.string().trim().min(2, "Qualifications must be at least 2 characters").max(1000),
    available_times: z.string().trim().max(1000, "Available times cannot exceed 1000 characters").optional(),
  };
}

export function createApplicationSchema(allowedSubjects?: string[]) {
  const guardianFields = buildGuardianFields(allowedSubjects);
  const studentFields = buildStudentFields(allowedSubjects);
  const teacherFields = buildTeacherFields(allowedSubjects);

  const guardianUpper = z.object({ type: z.literal("GUARDIAN"), ...guardianFields });
  const guardianLower = z.object({ type: z.literal("guardian"), ...guardianFields });

  const studentUpper = z.object({ type: z.literal("STUDENT"), ...studentFields });
  const studentLower = z.object({ type: z.literal("student"), ...studentFields });

  const teacherUpper = z.object({ type: z.literal("TEACHER"), ...teacherFields });
  const teacherLower = z.object({ type: z.literal("teacher"), ...teacherFields });

  const unionSchema = z.discriminatedUnion("type", [
    guardianUpper,
    guardianLower,
    studentUpper,
    studentLower,
    teacherUpper,
    teacherLower,
  ]);

  return unionSchema.superRefine((val, ctx) => {
    if (val.type === "STUDENT" || val.type === "student") {
      const age = calculateAge(val.date_of_birth);
      if (age < 18) {
        if (!val.guardian_name || val.guardian_name.trim().length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["guardian_name"],
            message: "Guardian name is required for applicants under 18",
          });
        }
        if (!val.guardian_phone || !egyptPhoneRegex.test(val.guardian_phone.replace(/[\s()-]/g, ""))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["guardian_phone"],
            message: "Valid guardian WhatsApp phone is required for applicants under 18",
          });
        }
        if (!val.guardian_relationship) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["guardian_relationship"],
            message: "Guardian relationship (father or mother) is required for applicants under 18",
          });
        }
      }
    }
  });
}

export const applicationSchema = createApplicationSchema();

export type ApplicationInput = z.infer<typeof applicationSchema>;

export function extractApplicationSubjects(input: ApplicationInput): string[] {
  if (input.type === "GUARDIAN" || input.type === "guardian") {
    return Array.from(new Set(input.children.flatMap((c) => c.subjects)));
  }
  return Array.from(new Set(input.subjects));
}

export function validateApplicationSubjects(
  input: ApplicationInput,
  allowedSubjects: string[] | Set<string>
): { valid: boolean; unknownSubjects: string[]; fieldErrors?: Record<string, string[]> } {
  const allowedSet = allowedSubjects instanceof Set ? allowedSubjects : new Set(allowedSubjects);
  const unknownSubjects: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  if (input.type === "GUARDIAN" || input.type === "guardian") {
    input.children.forEach((child, idx) => {
      const childUnknown = child.subjects.filter((s) => !allowedSet.has(s));
      if (childUnknown.length > 0) {
        unknownSubjects.push(...childUnknown);
        fieldErrors[`children.${idx}.subjects`] = [
          `Unknown subjects: ${childUnknown.join(", ")}`,
        ];
      }
    });
  } else {
    const unknown = input.subjects.filter((s) => !allowedSet.has(s));
    if (unknown.length > 0) {
      unknownSubjects.push(...unknown);
      fieldErrors["subjects"] = [`Unknown subjects: ${unknown.join(", ")}`];
    }
  }

  return {
    valid: unknownSubjects.length === 0,
    unknownSubjects: Array.from(new Set(unknownSubjects)),
    fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
  };
}

export function normalizeApplication(input: ApplicationInput) {
  const phone_whatsapp = normalizeEgyptPhone(input.phone_whatsapp);
  const email = input.email ? input.email.trim() : undefined;

  if (input.type === "GUARDIAN" || input.type === "guardian") {
    return {
      ...input,
      type: "GUARDIAN" as const,
      phone_whatsapp,
      email,
    };
  }

  if (input.type === "STUDENT" || input.type === "student") {
    return {
      ...input,
      type: "STUDENT" as const,
      phone_whatsapp,
      email,
      guardian_phone: input.guardian_phone ? normalizeEgyptPhone(input.guardian_phone) : undefined,
    };
  }

  return {
    ...input,
    type: "TEACHER" as const,
    phone_whatsapp,
    email,
  };
}
