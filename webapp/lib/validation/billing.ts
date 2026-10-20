import { z } from "zod";

export const billingPlanCreateSchema = z.object({
  nameAr: z.string().trim().min(1, "Arabic plan name is required."),
  nameEn: z.string().trim().min(1, "English plan name is required."),
  packageType: z.enum(["MONTHLY_PLAN", "ANNUAL_PLAN"]),
  sessionsPerMonth: z.number().int().positive("Sessions per month must be greater than zero."),
  basePriceMinor: z.union([z.string(), z.number()]).refine(
    (val) => {
      try {
        return BigInt(val) > BigInt(0);
      } catch {
        return false;
      }
    },
    { message: "Base price must be a positive integer minor unit amount." }
  ),
  currency: z.enum(["EGP", "USD"]).default("EGP"),
  tier: z.string().trim().optional(),
});

export const billingPlanUpdateSchema = z.object({
  nameAr: z.string().trim().min(1).optional(),
  nameEn: z.string().trim().min(1).optional(),
  basePriceMinor: z.union([z.string(), z.number()]).refine(
    (val) => {
      try {
        return BigInt(val) > BigInt(0);
      } catch {
        return false;
      }
    },
    { message: "Base price must be a positive integer minor unit amount." }
  ).optional(),
  tier: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

export const exchangeRateCreateSchema = z.object({
  fromCurrency: z.string().trim().length(3).toUpperCase(),
  toCurrency: z.string().trim().length(3).toUpperCase(),
  rate: z.union([z.string(), z.number()]).refine(
    (val) => {
      const n = typeof val === "string" ? parseFloat(val) : val;
      return !isNaN(n) && n > 0;
    },
    { message: "Exchange rate must be a positive decimal." }
  ),
});

export const payPerSessionConfigSchema = z.object({
  minSessions: z.number().int().min(1).max(50),
  maxSessions: z.number().int().min(1).max(50),
}).refine((data) => data.minSessions <= data.maxSessions, {
  message: "Minimum sessions must be less than or equal to maximum sessions.",
  path: ["minSessions"],
});
