import "server-only";

import { Prisma } from "../../generated/prisma/client";

import { platformBaseUrl, platformUrl } from "../config/platform-url";
import type { AuthUser } from "../dal";
import { canActOnStudentFinance } from "../guards/finance-access";
import { writePaymentAudit } from "../payments/audit";
import { PaymobSubscriptionClient } from "../payments/paymob-subscriptions";
import { PaymentProviderError } from "../payments/types";
import { prisma } from "../prisma";
import { firstPeriod } from "./renewal-dates";

/**
 * Automatic-renewal sign-up (D53 monthly only, D55 the sign-up payment is month 1,
 * D57 consent, SQL S-7b). The payer's consent is stored on an INCOMPLETE billing
 * subscription together with a PENDING month-1 invoice linked to it; Paymob's
 * Intention API (subscription plan + 3DS card integration) returns the Unified
 * Checkout URL. The subscription becomes ACTIVE only after the signed transaction
 * callback settles that invoice and the Paymob subscription is found by its
 * transaction (activateSignup). Only the payer may consent: the linked guardian, or
 * an adult student without a guardian — never the Admin on their behalf.
 */
export type SignupResult =
  | { ok: true; checkoutUrl: string; billingSubscriptionId: string }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): SignupResult => ({ ok: false, status, code, message });

export function isSignupConfigured(): boolean {
  return ["PAYMOB_API_KEY", "PAYMOB_SECRET_KEY", "PAYMOB_PUBLIC_KEY", "PAYMOB_INTEGRATION_ID_EGP"].every((name) => Boolean(process.env[name])) && platformBaseUrl() !== null;
}

function splitName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "Customer", lastName: parts.slice(1).join(" ") || "Customer" };
}

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

export async function startRenewalSignup(
  input: { user: AuthUser; studentId: string; planId: string; locale: "ar" | "en" },
  client: Pick<PaymobSubscriptionClient, "createSignupIntention"> = new PaymobSubscriptionClient(),
): Promise<SignupResult> {
  const { user } = input;
  if (!isSignupConfigured()) return fail(503, "NOT_CONFIGURED", "Automatic renewal is not available yet.");
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, academyId: user.academyId },
    select: { id: true, userId: true, guardianId: true, isAdult: true, guardian: { select: { userId: true } } },
  });
  if (!student || user.role === "ADMIN" || !canActOnStudentFinance(user, student, { allowAdmin: false })) {
    return fail(404, "NOT_FOUND", "Student was not found.");
  }
  const plan = await prisma.billingPlan.findFirst({ where: { id: input.planId, academyId: user.academyId, isActive: true } });
  if (!plan) return fail(404, "NOT_FOUND", "Plan was not found.");
  if (plan.packageType !== "MONTHLY_PLAN") return fail(409, "PLAN_NOT_MONTHLY", "Only monthly plans renew automatically.");
  if (!plan.providerPlanId || plan.currency !== "EGP") return fail(409, "PLAN_NOT_READY", "This plan is not ready for automatic renewal.");
  const payer = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { displayName: true, email: true, phone: true, timezone: true } });

  const now = new Date();
  const period = firstPeriod(now, payer.timezone || "Africa/Cairo");
  let created: { subId: string; invoiceId: string; attemptId: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const sub = await tx.billingSubscription.create({
        data: {
          academyId: user.academyId,
          studentId: student.id,
          payerUserId: user.id,
          planId: plan.id,
          currency: plan.currency,
          status: "INCOMPLETE",
          lockedPriceMinor: plan.basePriceMinor,
          // Placeholder until activation sets the D56 period from the paid time.
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          consentTimestamp: now,
          autoRenew: true,
        },
      });
      const invoice = await tx.invoice.create({
        data: {
          academyId: user.academyId,
          studentId: student.id,
          amountMinor: plan.basePriceMinor,
          currency: plan.currency,
          provider: "PAYMOB",
          packageType: "MONTHLY_PLAN",
          sessionsPurchased: plan.sessionsPerMonth,
          status: "PENDING",
          billingSubscriptionId: sub.id,
          billingPeriodStart: new Date(`${period.startDate}T00:00:00Z`),
        },
      });
      const attempt = await tx.paymentAttempt.create({
        data: { invoiceId: invoice.id, provider: "PAYMOB", idempotencyKey: `renewal-signup:${invoice.id}`, status: "CREATED" },
      });
      await writePaymentAudit({
        academyId: user.academyId,
        invoiceId: invoice.id,
        eventType: "CREATED",
        actorId: user.id,
        actorRole: user.role === "GUARDIAN" ? "GUARDIAN" : "STUDENT",
        metadata: { provider: "PAYMOB", amountMinor: plan.basePriceMinor.toString(), currency: plan.currency, packageType: "MONTHLY_PLAN", sessionsPurchased: plan.sessionsPerMonth, reason: "RENEWAL_SIGNUP" },
      }, tx);
      return { subId: sub.id, invoiceId: invoice.id, attemptId: attempt.id };
    });
  } catch (cause) {
    // SQL S-7b: one live automatic renewal per student.
    if (isUniqueViolation(cause)) return fail(409, "ALREADY_SUBSCRIBED", "This student already has automatic renewal.");
    throw cause;
  }

  try {
    const name = splitName(payer.displayName);
    const intention = await client.createSignupIntention({
      planProviderId: plan.providerPlanId,
      amountMinor: plan.basePriceMinor,
      specialReference: created.invoiceId,
      notificationUrl: platformUrl("/api/payments/paymob/webhook")!,
      redirectionUrl: platformUrl(`/${input.locale}/payments/paymob/return`)!,
      billing: { ...name, email: payer.email ?? "no-email@zarabicschool.local", phone: payer.phone ?? "0000000000" },
    });
    await prisma.paymentAttempt.update({
      where: { id: created.attemptId },
      // A1: the provider ORDER id is the callback match key (HMAC-covered).
      data: { status: "REDIRECTED", providerOrderId: intention.providerOrderId, providerReference: intention.providerOrderId, checkoutUrl: intention.checkoutUrl },
    });
    return { ok: true, checkoutUrl: intention.checkoutUrl, billingSubscriptionId: created.subId };
  } catch (cause) {
    if (!(cause instanceof PaymentProviderError)) throw cause;
    // Paymob refused: nothing can be paid, so the sign-up ends here (no money moved).
    await prisma.$transaction([
      prisma.paymentAttempt.update({ where: { id: created.attemptId }, data: { status: "FAILED" } }),
      prisma.invoice.update({ where: { id: created.invoiceId }, data: { status: "CANCELLED" } }),
      prisma.billingSubscription.update({ where: { id: created.subId }, data: { status: "CANCELED", autoRenew: false, canceledAt: new Date() } }),
    ]);
    return fail(cause.code === "NOT_CONFIGURED" ? 503 : 502, cause.code, "Automatic renewal could not be started at the payment provider. Please try again later.");
  }
}
