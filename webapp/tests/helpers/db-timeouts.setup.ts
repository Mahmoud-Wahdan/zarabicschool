import { prisma } from "../../lib/prisma";

/**
 * TEST CONFIGURATION ONLY (owner decision 2026-10-26). The app keeps Prisma's
 * default transaction limits (maxWait 2 s, timeout 5 s). Tests run from a dev
 * machine against the remote dev database (~64 ms per round trip, more when the
 * pooler is busy), and a settlement transaction is 10–20 round trips, so a slow
 * moment can exceed 5 s. Settlement is atomic and idempotent — a timeout rolls back
 * and a retry is safe — so the tests get longer limits instead of the app.
 * See docs/specs/phase-08-testing-launch.md, "Decision: transaction timeouts".
 */
const TEST_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

const original = prisma.$transaction.bind(prisma) as (arg: unknown, options?: Record<string, unknown>) => Promise<unknown>;

(prisma as unknown as { $transaction: (arg: unknown, options?: Record<string, unknown>) => Promise<unknown> }).$transaction = (
  arg,
  options,
) => original(arg, { ...TEST_TRANSACTION_OPTIONS, ...options });
