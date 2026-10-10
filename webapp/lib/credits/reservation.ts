import { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";

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

export async function runSerializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (cause) {
      if (!(cause instanceof Prisma.PrismaClientKnownRequestError) || cause.code !== "P2034" || attempt === 2) {
        throw cause;
      }
    }
  }
  throw new Error("Serializable transaction retry limit reached.");
}
