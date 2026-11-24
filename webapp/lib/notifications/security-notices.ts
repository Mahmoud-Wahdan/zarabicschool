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
      payload: {
        action: input.action,
        inAppOnly: Boolean(input.inAppOnly),
      },
    },
    select: { id: true },
  });

  return { eventId: event.id, notificationJobId: job.id };
}
