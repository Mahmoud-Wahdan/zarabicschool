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

function isTransactionConflict(cause: unknown): boolean {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2034") return true;
  if (typeof cause === "object" && cause !== null) {
    const code = (cause as { code?: unknown }).code;
    if (code === "P2034" || code === "40001") return true;
    const name = (cause as { name?: unknown }).name;
    const message = (cause as { message?: unknown }).message;
    const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`;
    if (text.includes("TransactionWriteConflict") || text.includes("40001") || text.includes("could not serialize access")) {
      return true;
    }
    const nested = (cause as { cause?: unknown }).cause;
    if (nested && nested !== cause) return isTransactionConflict(nested);
  }
  return false;
}

function retryDelayMs(attempt: number): number {
  return 150 + attempt * 100 + Math.floor(Math.random() * 150);
}

export async function runSerializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable", timeout: 30_000, maxWait: 10_000 });
    } catch (cause) {
      if (!isTransactionConflict(cause) || attempt === 4) {
        throw cause;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }
  throw new Error("Serializable transaction retry limit reached.");
}
