import { z } from "zod";

const currencySchema = z.enum(["EGP", "USD"]);
const isoDateTime = z.string().datetime({ offset: true });

/**
 * Admin creates a PENDING invoice — the amount lives on the invoice, never on the
 * client at pay time. The exchange-rate snapshot is NOT client input: the API
 * selects the academy's current effective rate from the ExchangeRates
 * configuration (Phase 6b rule — server-side configuration only).
 */
export const invoiceCreateSchema = z.object({
  studentId: z.guid(),
  packageType: z.enum(["MONTHLY_PLAN", "ANNUAL_PLAN", "PAY_PER_SESSION"]),
  sessionsPurchased: z.number().int().min(1).max(500),
  amountMinor: z.number().int().min(1).max(100_000_000),
  currency: currencySchema,
  provider: z.enum(["PAYMOB", "USD_GATEWAY"]),
});

/** Admin confirms a manual payment (proof fallback). Same transition as the signed webhook. */
export const invoiceConfirmSchema = z.object({
  reference: z.string().trim().max(200).optional().or(z.literal("")),
  paymentProofId: z.guid().optional(),
});

/** Payer uploads a payment proof (image/PDF ≤ 10 MB, magic-byte validated). */
export const paymentProofMetaSchema = z.object({
  reference: z.string().trim().max(200).optional().or(z.literal("")),
});

/** Admin reviews a proof. Confirming does NOT settle the invoice by itself — the
 * invoice confirmation route performs the authoritative transition. */
export const paymentProofReviewSchema = z.object({
  action: z.enum(["CONFIRM", "REJECT"]),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Admin overtime review on an APPROVED/ARCHIVED report with a PENDING claim. */
export const overtimeReviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
});

/** Admin manual payroll adjustment (bonus/fine/correction) — reason mandatory. */
/** payroll_ledger.amount_minor is a 32-bit INTEGER: a larger amount can never be
 *  stored, so it is a validation error (400), not a database error (500).
 *  M-5 (owner, 2026-10-27): this cap is KEPT on purpose — it is NOT aligned with the
 *  100,000,000 sanity cap of invoices and hourly rates. One entry may therefore be up
 *  to 21,474,836.47 in major units; revisit together with BIGINT at SaaS time (CONTEXT §7 item 9). */
const PAYROLL_AMOUNT_LIMIT = 2_147_483_647;

export const payrollAdjustmentSchema = z.object({
  teacherId: z.guid(),
  amountMinor: z.number().int().min(-PAYROLL_AMOUNT_LIMIT).max(PAYROLL_AMOUNT_LIMIT).refine((value) => value !== 0, "The amount must not be zero."),
  currency: currencySchema,
  reason: z.string().trim().min(2).max(1000),
});

/** Admin records a payout/disbursement — an internal ledger record, never proof of an external transfer. */
export const payrollDisbursementSchema = z.object({
  teacherId: z.guid(),
  amountMinor: z.number().int().positive().max(PAYROLL_AMOUNT_LIMIT),
  currency: currencySchema,
  reason: z.string().trim().min(2).max(1000),
});

/** Admin sets the effective-dated hourly teacher rate. */
export const teacherRateCreateSchema = z.object({
  teacherId: z.guid(),
  hourlyRateMinor: z.number().int().positive().max(100_000_000),
  currency: currencySchema,
  effectiveFrom: isoDateTime,
});
