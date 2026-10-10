import type { Prisma } from "../../generated/prisma/client";

export async function enqueueSessionJobs(
  tx: Prisma.TransactionClient,
  academyId: string,
  sessionId: string,
  scheduledStart: Date,
  teacherUserId: string,
  studentUserIds: string[],
  guardianUserIds: string[],
) {
  const recipientUserIds = [...new Set([teacherUserId, ...studentUserIds, ...guardianUserIds])];
  const jobs = recipientUserIds.flatMap((recipientUserId) => [
    {
      academyId,
      sessionId,
      recipientUserId,
      kind: "SESSION_REMINDER",
      dedupKey: `SESSION_REMINDER:${sessionId}:${recipientUserId}`,
      scheduledFor: new Date(scheduledStart.getTime() - 2 * 60 * 60 * 1000),
    },
    {
      academyId,
      sessionId,
      recipientUserId,
      kind: "SESSION_START",
      dedupKey: `SESSION_START:${sessionId}:${recipientUserId}`,
      scheduledFor: scheduledStart,
    },
  ]);
  await tx.notificationJob.createMany({ data: jobs, skipDuplicates: true });
}
