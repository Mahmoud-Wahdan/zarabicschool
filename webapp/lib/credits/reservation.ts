import "server-only";

import { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";

// The transaction-scoped credit helpers live in a dependency-free module so seeds
// and scripts can import them without pulling in the server-only prisma client.
export { hasAvailableCredit, reserveCredit } from "./reserve-credit";

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
