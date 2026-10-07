import "server-only";

import { getMessagingProvider } from "../messaging/provider";
import { prisma } from "../prisma";

export async function processPendingNotificationJobs(now = new Date()) {
  const jobs = await prisma.notificationJob.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now }, session: { status: { not: "CANCELLED" } } },
    orderBy: { scheduledFor: "asc" },
    take: 50,
    include: {
      recipientUser: { select: { id: true, phone: true } },
      session: { select: { scheduledStart: true, zoomJoinUrl: true, subject: { select: { nameEn: true } } } },
    },
  });
  const provider = getMessagingProvider();
  for (const job of jobs) {
    const claimed = await prisma.notificationJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    if (!job.session) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: "Session no longer exists." } });
      continue;
    }
    const message = job.kind === "SESSION_START"
      ? `Your ${job.session.subject.nameEn} session starts now. Join: ${job.session.zoomJoinUrl}`
      : `Reminder: your ${job.session.subject.nameEn} session starts at ${job.session.scheduledStart.toISOString()}.`;
    const result = await provider.sendText({ userId: job.recipientUser.id, phone: job.recipientUser.phone }, message);
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: result.ok
        ? { status: "SENT", sentAt: new Date(), lastError: null }
        : { status: "FAILED", lastError: result.error ?? "Messaging provider failed." },
    });
  }
}
