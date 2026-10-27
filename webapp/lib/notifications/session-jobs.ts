import type { Prisma } from "../../generated/prisma/client";
import { getJoinWindowMinutes } from "../sessions/join-window";

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
  // D4 (owner, 2026-10-27): the reminder goes out when the join window opens and
  // carries the platform join link; it replaces the old T−2h reminder.
  const windowMinutes = await getJoinWindowMinutes(academyId, tx);
  const jobs = recipientUserIds.flatMap((recipientUserId) => [
    {
      academyId,
      sessionId,
      recipientUserId,
      kind: "SESSION_REMINDER",
      dedupKey: `SESSION_REMINDER:${sessionId}:${recipientUserId}`,
      scheduledFor: new Date(scheduledStart.getTime() - windowMinutes * 60 * 1000),
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

export async function enqueueSeriesPausedFlag(
  tx: Prisma.TransactionClient,
  academyId: string,
  seriesId: string,
  pendingWeekIndex: number,
) {
  const admins = await tx.user.findMany({
    where: { academyId, role: "ADMIN", isActive: true },
    select: { id: true },
  });
  await tx.notificationJob.createMany({
    data: admins.map((admin) => ({
      academyId,
      sessionId: null,
      recipientUserId: admin.id,
      kind: "SERIES_PAUSED",
      dedupKey: `SERIES_PAUSED:${seriesId}:${admin.id}:${pendingWeekIndex}`,
      scheduledFor: new Date(),
    })),
    skipDuplicates: true,
  });
}
