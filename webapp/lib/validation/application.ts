import { z } from "zod";

const egyptPhone = /^(?:\+20|0020|0)?1[0125]\d{8}$/;
const currencies = ["USD", "EGP"] as const;

function normalizeEgyptPhone(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  if (compact.startsWith("+20")) return compact;
  if (compact.startsWith("0020")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return `+20${compact.slice(1)}`;
  return `+20${compact}`;
}

const common = {
  full_name: z.string().trim().min(2).max(100),
  phone_whatsapp: z.string().trim().refine((value) => egyptPhone.test(value.replace(/[\s()-]/g, "")), "Invalid WhatsApp phone number"),
  email: z.string().trim().email().optional().or(z.literal("")),
  timezone: z.string().trim().min(1).max(100).default("Africa/Cairo"),
  preferred_language: z.enum(["ar", "en"]).default("ar"),
  notes: z.string().trim().max(1000).optional(),
  honeypot: z.string().max(0).optional(),
};

const guardian = z.object({
  type: z.literal("GUARDIAN"),
  ...common,
  children: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    age: z.number().int().min(3).max(25),
    subjects: z.array(z.string().trim().min(1)).min(1),
  })).min(1).max(10),
  preferred_times: z.string().trim().max(1000).optional(),
});

const student = z.object({
  type: z.literal("STUDENT"),
  ...common,
  date_of_birth: z.string().date(),
  subjects: z.array(z.string().trim().min(1)).min(1),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  preferred_times: z.string().trim().max(1000).optional(),
  guardian_name: z.string().trim().min(2).max(100).optional(),
  guardian_phone: z.string().trim().optional(),
  guardian_relationship: z.enum(["father", "mother"]).optional(),
}).superRefine((value, context) => {
  const birthDate = new Date(`${value.date_of_birth}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > birthDate.getUTCMonth()
    || (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate());
  if (!birthdayPassed) age -= 1;

  if (age < 18) {
    if (!value.guardian_name) context.addIssue({ code: "custom", path: ["guardian_name"], message: "Guardian name is required for minors" });
    if (!value.guardian_phone || !egyptPhone.test(value.guardian_phone.replace(/[\s()-]/g, ""))) context.addIssue({ code: "custom", path: ["guardian_phone"], message: "Guardian phone is required for minors" });
    if (!value.guardian_relationship) context.addIssue({ code: "custom", path: ["guardian_relationship"], message: "Guardian relationship is required for minors" });
  }
});

const teacher = z.object({
  type: z.literal("TEACHER"),
  ...common,
  subjects: z.array(z.string().trim().min(1)).min(1),
  years_experience: z.number().int().min(0).max(50),
  qualifications: z.string().trim().max(1000),
  expected_hourly_rate: z.number().int().positive(),
  currency: z.enum(currencies),
  available_times: z.string().trim().max(1000).optional(),
});

export const applicationSchema = z.discriminatedUnion("type", [guardian, student, teacher]);
export type ApplicationInput = z.infer<typeof applicationSchema>;

export function normalizeApplication(input: ApplicationInput) {
  return {
    ...input,
    phone_whatsapp: normalizeEgyptPhone(input.phone_whatsapp),
    email: input.email || undefined,
    ...(input.type === "STUDENT" && input.guardian_phone
      ? { guardian_phone: normalizeEgyptPhone(input.guardian_phone) }
      : {}),
  };
}
