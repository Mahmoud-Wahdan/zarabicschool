import { z } from "zod";

import { toInternationalDigits } from "../messaging/phone";
import { usernamePattern } from "./shared";

const phoneField = z
  .string()
  .trim()
  .refine((val) => toInternationalDigits(val), {
    message: "Enter a phone number with its country code, e.g. +44 7700 900123",
  });

export const approveApplicationSchema = z
  .object({
    relationship: z.enum(["father", "mother"]).optional(),
    existingGuardianId: z.guid().optional(),
    createGuardian: z
      .object({
        full_name: z.string().trim().min(2, "Guardian name must be at least 2 characters").max(100),
        phone_whatsapp: phoneField,
        relationship: z.enum(["father", "mother"]),
      })
      .optional(),
    accounts: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(30),
          username: z
            .string()
            .trim()
            .min(3, "Username must be at least 3 characters")
            .max(30, "Username must be at most 30 characters")
            .regex(usernamePattern, "Username can only contain letters, numbers, dots, dashes and underscores"),
        })
      )
      .max(20, "Too many account overrides")
      .optional(),
    teachers: z
      .record(
        z.string().trim().min(1).max(30),
        z.record(z.string().trim().min(1).max(80), z.guid())
      )
      .optional(),
  })
  .refine((value) => !(value.existingGuardianId && value.createGuardian), {
    message: "Choose either an existing guardian or create a new one, not both.",
    path: ["existingGuardianId"],
  });

export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;
