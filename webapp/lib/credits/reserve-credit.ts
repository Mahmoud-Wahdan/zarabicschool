import type { Prisma } from "../../generated/prisma/client";

// Pure credit-booking helpers: they take a transaction/prisma client as a parameter
// and intentionally import nothing from lib/prisma (no "server-only"), so seeds,
// workers, tests, and routes can all use them.

export async function reserveCredit(
  tx: Prisma.TransactionClient,
  academyId: string,
  studentId: string,
  sessionId: string,
  sessionDate: Date,
) {
  const subscriptions = await tx.subscription.findMany({
    where: {
      academyId,
      studentId,
      status: "ACTIVE",
      OR: [
        { packageType: "PAY_PER_SESSION" },
        {
          periodStartsAt: { lte: sessionDate },
          periodEndsAt: { gt: sessionDate },
        },
      ],
    },
    orderBy: [{ periodEndsAt: "asc" }, { createdAt: "asc" }],
    include: {
      ledgerEntries: { select: { sessionsDelta: true } },
      reservations: { where: { status: "RESERVED" }, select: { id: true } },
    },
  });
  const subscription = subscriptions.find((item) => {
    const balance = item.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0);
    return balance - item.reservations.length > 0;
  });
  if (!subscription) return false;
  const existing = await tx.sessionReservation.findUnique({ where: { sessionId_studentId: { sessionId, studentId } } });
  if (existing) {
    if (existing.status === "RESERVED" || existing.status === "CONSUMED") return false;
    await tx.sessionReservation.update({
      where: { id: existing.id },
      data: { status: "RESERVED", releasedAt: null, subscriptionId: subscription.id },
    });
  } else {
    await tx.sessionReservation.create({
      data: { academyId, sessionId, studentId, subscriptionId: subscription.id },
    });
  }
  return true;
}

export async function hasAvailableCredit(
  tx: Prisma.TransactionClient,
  academyId: string,
  studentId: string,
  sessionDate: Date,
) {
  const subscriptions = await tx.subscription.findMany({
    where: {
      academyId,
      studentId,
      status: "ACTIVE",
      OR: [
        { packageType: "PAY_PER_SESSION" },
        { periodStartsAt: { lte: sessionDate }, periodEndsAt: { gt: sessionDate } },
      ],
    },
    include: {
      ledgerEntries: { select: { sessionsDelta: true } },
      reservations: { where: { status: "RESERVED" }, select: { id: true } },
    },
  });
  return subscriptions.some((subscription) => {
    const balance = subscription.ledgerEntries.reduce((total, entry) => total + entry.sessionsDelta, 0);
    return balance > subscription.reservations.length;
  });
}
