import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../prisma";

const ENTRY_SELECT = { id: true, teacherId: true, entryType: true, amountMinor: true, currency: true, createdAt: true } as const;

/**
 * Shared writer for the two Admin-only manual payroll entries (A5 / P13):
 * ADMIN_ADJUSTMENT (signed) and DISBURSEMENT (stored negative).
 *
 * - Idempotency: an optional `Idempotency-Key` header (UUID). The same key again
 *   returns the row it already created (200) instead of writing a second one; the
 *   same key with a DIFFERENT teacher/type/amount/currency is refused (409
 *   IDEMPOTENCY_KEY_REUSED); a different `reason` alone replays the first row. The
 *   partial unique index payroll_ledger_idempotency_key_key settles a race.
 * - Currency: one currency per teacher (CONTEXT §7 item 9) = the currency of the
 *   teacher's current hourly rate. No rate → 409 NO_TEACHER_RATE; a different
 *   currency → 409 CURRENCY_MISMATCH.
 */
export async function createManualPayrollEntry(
  request: Request,
  admin: { id: string; academyId: string },
  entry: {
    entryType: "ADMIN_ADJUSTMENT" | "DISBURSEMENT";
    teacherId: string;
    amountMinor: number;
    currency: string;
    reason: string;
<<<<<<< HEAD
    /** S-12 / D14: the category of an ADMIN_ADJUSTMENT (SQL S-5). */
    adjustmentCategory?: "BONUS" | "FINE" | "OVERTIME" | "OTHER";
  },
  /** A server-chosen key (e.g. the one reversal of an entry) instead of the header. */
  fixedIdempotencyKey?: string,
) {
  const rawKey = fixedIdempotencyKey ?? request.headers.get("idempotency-key");
=======
  },
) {
  const rawKey = request.headers.get("idempotency-key");
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
  let idempotencyKey: string | null = null;
  if (rawKey !== null) {
    const parsedKey = z.uuid().safeParse(rawKey.trim());
    if (!parsedKey.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Idempotency-Key must be a UUID." } }, { status: 400 });
    }
    idempotencyKey = parsedKey.data.toLowerCase();
  }

  const teacher = await prisma.teacher.findFirst({
    where: { id: entry.teacherId, academyId: admin.academyId },
<<<<<<< HEAD
    select: { id: true, userId: true },
=======
    select: { id: true },
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
  });
  if (!teacher) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher not found." } }, { status: 404 });

  const sameEntry = (row: { teacherId: string; entryType: string; amountMinor: number; currency: string }) =>
    row.teacherId === teacher.id && row.entryType === entry.entryType && row.amountMinor === entry.amountMinor && row.currency === entry.currency;
  const replay = async () => {
    if (!idempotencyKey) return null;
    const existing = await prisma.payrollLedger.findFirst({
      where: { idempotencyKey, academyId: admin.academyId },
      select: ENTRY_SELECT,
    });
    if (!existing) return null;
    return sameEntry(existing)
      ? NextResponse.json({ data: existing, idempotentReplay: true }, { status: 200 })
      : NextResponse.json({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "This Idempotency-Key was already used for a different entry." } }, { status: 409 });
  };
  const replayed = await replay();
  if (replayed) return replayed;

  const rate = await prisma.teacherRate.findFirst({
    where: { teacherId: teacher.id, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: "desc" },
    select: { currency: true },
  });
  if (!rate) {
    return NextResponse.json({ error: { code: "NO_TEACHER_RATE", message: "Set an hourly rate for this teacher first; it fixes the teacher's currency." } }, { status: 409 });
  }
  if (rate.currency !== entry.currency) {
    return NextResponse.json({ error: { code: "CURRENCY_MISMATCH", message: `This teacher is paid in ${rate.currency}.` } }, { status: 409 });
  }

  try {
    const created = await prisma.payrollLedger.create({
      data: {
        academyId: admin.academyId,
        teacherId: teacher.id,
        entryType: entry.entryType,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        reason: entry.reason,
        createdById: admin.id,
        idempotencyKey,
<<<<<<< HEAD
        ...(entry.entryType === "ADMIN_ADJUSTMENT" && entry.adjustmentCategory ? { adjustmentCategory: entry.adjustmentCategory } : {}),
      },
      select: ENTRY_SELECT,
    });
    if (entry.entryType === "ADMIN_ADJUSTMENT") {
      // D14: an IN-APP notice to the teacher only — recorded as delivered (SENT) so
      // the worker never hands it to WhatsApp. Ids only, never the amount or reason.
      await prisma.notificationJob.createMany({
        data: [{ academyId: admin.academyId, sessionId: null, recipientUserId: teacher.userId, kind: "PAYROLL_ADJUSTMENT", dedupKey: `PAYROLL_ADJUSTMENT:${created.id}`, scheduledFor: new Date(), status: "SENT", sentAt: new Date(), payload: { entryId: created.id } }],
        skipDuplicates: true,
      });
    }
=======
      },
      select: ENTRY_SELECT,
    });
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (cause) {
    // Two concurrent requests with the same key: the loser reads the winner's row.
    if (idempotencyKey && cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      const raced = await replay();
      if (raced) return raced;
      // The key exists for another academy (global unique index): never a 500.
      return NextResponse.json({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "This Idempotency-Key was already used." } }, { status: 409 });
    }
    throw cause;
  }
}
