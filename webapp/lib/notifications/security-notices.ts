import { getMessagingProvider } from "../messaging/provider";
import { prisma } from "../prisma";
import { platformUrl } from "../config/platform-url";
import type { Prisma, UserSecurityAction } from "../../generated/prisma/client";

/**
 * Records an account security event and enqueues its corresponding generic
 * notification job within the provided transaction.
 *
 * Persists ONLY identifiers, the action enum, and the notice kind; never
 * persists credentials, field values, OTPs, cookies, or JWTs.
 */
export async function recordAccountSecurityEvent(
  tx: Prisma.TransactionClient,
  input: {
    academyId: string;
    actorUserId: string;
    targetUserId: string;
    action: UserSecurityAction;
    inAppOnly?: boolean;
  },
): Promise<{ eventId: string; notificationJobId: string }> {
  const event = await tx.userSecurityEvent.create({
    data: {
      academyId: input.academyId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.action,
    },
    select: { id: true },
  });

  const now = new Date();
  const job = await tx.notificationJob.create({
    data: {
      academyId: input.academyId,
      recipientUserId: input.targetUserId,
      kind: "ACCOUNT_SECURITY_NOTICE",
      dedupKey: `ACCOUNT_SECURITY_NOTICE:${event.id}`,
      scheduledFor: now,
      // Reserve direct old-number sends before commit. The queue cannot send them to the new number.
      ...(input.inAppOnly ? { status: "PROCESSING", attempts: 1 } : {}),
      payload: {
        action: input.action,
        inAppOnly: Boolean(input.inAppOnly),
      },
    },
    select: { id: true },
  });

  return { eventId: event.id, notificationJobId: job.id };
}

export function composeAccountSecurityNotice(language: "ar" | "en", loginUrl: string): string {
  return language === "en"
    ? `Your account information has changed. ${loginUrl}`
    : `تم تغيير معلومات حسابك. ${loginUrl}`;
}

type PhoneChangeNotice = {
  notificationJobId: string;
  userId: string;
  oldPhone: string | null;
  language: "ar" | "en";
};

export async function sendPhoneChangeNotice(input: PhoneChangeNotice): Promise<{ status: "SENT" | "FAILED" }> {
  const url = platformUrl(`/${input.language}/login`);
  let sent = false;
  try {
    if (input.oldPhone && url) {
      const result = await getMessagingProvider().sendText(
        { userId: input.userId, phone: input.oldPhone },
        composeAccountSecurityNotice(input.language, url),
        { idempotencyKey: `notification-job:${input.notificationJobId}` },
      );
      sent = result.ok;
    }
  } catch {
    // Provider exceptions may include recipient data. Persist only the outcome.
  }
  const status = sent ? "SENT" : "FAILED";
  try {
    await prisma.notificationJob.update({
      where: { id: input.notificationJobId },
      data: { status, sentAt: sent ? new Date() : null, lastError: sent ? null : "Account notice delivery failed." },
      select: { id: true },
    });
  } catch {
    // The account transaction committed. Stale-job recovery will close this reserved job without retrying.
    return { status: "FAILED" };
  }
  return { status };
}

/** Compare normalized scalar writes, including date-only fields represented as Date. */
export function accountFieldsChanged(current: object, patch: object): boolean {
  return Object.entries(patch).some(([key, value]) => {
    const previous = Reflect.get(current, key);
    if (value instanceof Date && previous instanceof Date) return value.getTime() !== previous.getTime();
    return value !== previous;
  });
}

export async function recordAccountUpdate(
  tx: Prisma.TransactionClient,
  actor: { id: string; academyId: string },
  target: { id: string; phone: string | null; preferredLanguage: string },
  patch: { phone?: string | null },
  action: UserSecurityAction = "ACCOUNT_UPDATED",
): Promise<PhoneChangeNotice | null> {
  const phoneChanged = patch.phone !== undefined && patch.phone !== target.phone;
  const { notificationJobId } = await recordAccountSecurityEvent(tx, {
    academyId: actor.academyId, actorUserId: actor.id, targetUserId: target.id, action, inAppOnly: phoneChanged,
  });
  return phoneChanged ? {
    notificationJobId, userId: target.id, oldPhone: target.phone, language: target.preferredLanguage === "en" ? "en" : "ar",
  } : null;
}
