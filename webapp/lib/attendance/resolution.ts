import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";
import { enqueueAdminFlag } from "../reports/settlement-seam";
import { lockSessionForReport } from "../reports/session-completion";

/**
 * Manual attendance resolution (S-01; D2, D36, D37; owner 2026-10-27). The exception
 * to the report-driven path, for ended sessions only:
 * - Admin any time; Supervisor within 7 days of the scheduled end (D36c);
 * - roster students only; refused while a SUBMITTED/APPROVED report exists, after a
 *   settlement, on a CANCELLED/MISSED session, or a second time (one per roster entry);
 * - ATTENDED = reservation CONSUMED + one SESSION_DEDUCTION (unique per session and
 *   subscription); BLOCKED when the student has no session left (owner: fix the
 *   package first — never a negative balance from this path);
 * - STUDENT_ABSENT = reservation RELEASED, no ledger row (DB CHECK);
 * - never a payroll entry, never a report, never a session status change (D36d);
 * - append-only audit row + a notice to every Admin, in ONE transaction that locks
 *   the session row FOR UPDATE first (same lock as report submission; approval takes
 *   FOR SHARE, which conflicts), so it serializes with the report paths.
 * The preview runs the same checks without writing, for the confirmation screen.
 */
export type ResolutionOutcome = "ATTENDED" | "STUDENT_ABSENT";
export type ResolutionActor = { id: string; role: string; academyId: string };

export const SUPERVISOR_RESOLUTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export class ResolutionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ResolutionError";
    this.code = code;
    this.status = status;
  }
}

export type ResolutionEffect = {
  attendance: ResolutionOutcome;
  deductsSession: boolean;
  releasesReservation: boolean;
  /** Always false: teacher pay comes only from the approved report (D2). */
  teacherCredited: false;
  sessionsLeftBefore: number;
  sessionsLeftAfter: number;
};

export type ResolutionPreview =
  | { canResolve: true; effect: ResolutionEffect }
  | { canResolve: false; blockCode: string; message: string };

type Plan = {
  effect: ResolutionEffect;
  reservation: { id: string; status: string; subscriptionId: string } | null;
  deductFrom: string | null;
};

/** Sessions left = ACTIVE credit minus RESERVED (the D29 read model's definition). */
async function sessionsLeft(client: Prisma.TransactionClient, academyId: string, studentId: string) {
  const subscriptions = await client.subscription.findMany({
    where: { academyId, studentId, status: "ACTIVE" },
    select: {
      ledgerEntries: { select: { sessionsDelta: true } },
      _count: { select: { reservations: { where: { status: "RESERVED" } } } },
    },
  });
  return subscriptions.reduce(
    (total, item) => total + item.ledgerEntries.reduce((sum, row) => sum + row.sessionsDelta, 0) - item._count.reservations,
    0,
  );
}

/** A package valid on the session date with free credit — the booking's order (reserveCredit). */
async function packageWithFreeCredit(client: Prisma.TransactionClient, academyId: string, studentId: string, sessionDate: Date) {
  const subscriptions = await client.subscription.findMany({
    where: {
      academyId,
      studentId,
      status: "ACTIVE",
      OR: [{ packageType: "PAY_PER_SESSION" }, { periodStartsAt: { lte: sessionDate }, periodEndsAt: { gt: sessionDate } }],
    },
    orderBy: [{ periodEndsAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      ledgerEntries: { select: { sessionsDelta: true } },
      _count: { select: { reservations: { where: { status: "RESERVED" } } } },
    },
  });
  const found = subscriptions.find(
    (item) => item.ledgerEntries.reduce((sum, row) => sum + row.sessionsDelta, 0) - item._count.reservations > 0,
  );
  return found?.id ?? null;
}

async function plan(
  client: Prisma.TransactionClient,
  actor: ResolutionActor,
  input: { sessionId: string; studentId: string; outcome: ResolutionOutcome },
  now: Date,
): Promise<Plan> {
  if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") {
    throw new ResolutionError("FORBIDDEN", "Only the Admin or the Supervisor can resolve attendance.", 403);
  }
  const session = await client.session.findFirst({
    where: { id: input.sessionId, academyId: actor.academyId, students: { some: { studentId: input.studentId } } },
    select: { id: true, status: true, scheduledStart: true, scheduledEnd: true },
  });
  if (!session) throw new ResolutionError("NOT_FOUND", "Session or roster student not found.", 404);
  if (session.status === "CANCELLED" || session.status === "MISSED") {
    throw new ResolutionError("SESSION_NOT_RESOLVABLE", `The session is ${session.status}; it did not take place.`, 409);
  }
  if (session.scheduledEnd.getTime() > now.getTime()) {
    throw new ResolutionError("SESSION_NOT_ENDED", "Attendance can be resolved only after the scheduled end.", 409);
  }
  if (actor.role === "SUPERVISOR" && now.getTime() - session.scheduledEnd.getTime() > SUPERVISOR_RESOLUTION_DAYS * DAY_MS) {
    throw new ResolutionError("ADMIN_ONLY_AFTER_7_DAYS", "More than 7 days after the scheduled end, only the Admin can resolve attendance.", 403);
  }
  const [existing, report, reservation, deduction] = await Promise.all([
    client.attendanceResolution.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: input.studentId } }, select: { id: true } }),
    client.report.findFirst({
      where: { sessionId: session.id, studentId: input.studentId, reportType: "SESSION_COMPLETION_REPORT", status: { in: ["SUBMITTED", "APPROVED", "ARCHIVED"] } },
      select: { id: true },
    }),
    client.sessionReservation.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId: input.studentId } },
      select: { id: true, status: true, subscriptionId: true },
    }),
    client.subscriptionLedger.findFirst({
      where: { sessionId: session.id, entryType: "SESSION_DEDUCTION", subscription: { studentId: input.studentId } },
      select: { id: true },
    }),
  ]);
  if (existing) throw new ResolutionError("ALREADY_RESOLVED", "This student's attendance was already resolved for this session.", 409);
  if (report) throw new ResolutionError("REPORT_EXISTS", "The teacher's report exists — review it in the reports queue instead.", 409);
  if (deduction || reservation?.status === "CONSUMED") {
    throw new ResolutionError("ALREADY_SETTLED", "This session is already settled for the student; corrections are new adjustment entries.", 409);
  }

  const before = await sessionsLeft(client, actor.academyId, input.studentId);
  const held = reservation?.status === "RESERVED" ? reservation : null;
  if (input.outcome === "STUDENT_ABSENT") {
    return {
      effect: { attendance: "STUDENT_ABSENT", deductsSession: false, releasesReservation: Boolean(held), teacherCredited: false, sessionsLeftBefore: before, sessionsLeftAfter: before + (held ? 1 : 0) },
      reservation: held,
      deductFrom: null,
    };
  }
  const deductFrom = held?.subscriptionId ?? (await packageWithFreeCredit(client, actor.academyId, input.studentId, session.scheduledStart));
  if (!deductFrom) {
    throw new ResolutionError("NO_SESSIONS_LEFT", "The student has no session left. Fix the package first, then resolve attendance.", 409);
  }
  return {
    effect: { attendance: "ATTENDED", deductsSession: true, releasesReservation: false, teacherCredited: false, sessionsLeftBefore: before, sessionsLeftAfter: held ? before : before - 1 },
    reservation: held,
    deductFrom,
  };
}

export async function previewResolution(
  actor: ResolutionActor,
  input: { sessionId: string; studentId: string; outcome: ResolutionOutcome },
  now = new Date(),
): Promise<ResolutionPreview> {
  try {
    const result = await plan(prisma, actor, input, now);
    return { canResolve: true, effect: result.effect };
  } catch (cause) {
    if (cause instanceof ResolutionError && cause.status === 409) {
      return { canResolve: false, blockCode: cause.code, message: cause.message };
    }
    throw cause;
  }
}

export async function resolveAttendance(
  actor: ResolutionActor,
  input: { sessionId: string; studentId: string; outcome: ResolutionOutcome; reason: string },
  now = new Date(),
) {
  return prisma.$transaction(
    async (tx) => {
      await lockSessionForReport(tx, input.sessionId);
      const result = await plan(tx, actor, input, now);
      let ledgerId: string | null = null;
      if (input.outcome === "ATTENDED" && result.deductFrom) {
        if (result.reservation) {
          await tx.sessionReservation.update({ where: { id: result.reservation.id }, data: { status: "CONSUMED" } });
        }
        const row = await tx.subscriptionLedger.create({
          data: {
            academyId: actor.academyId,
            subscriptionId: result.deductFrom,
            sessionId: input.sessionId,
            entryType: "SESSION_DEDUCTION",
            sessionsDelta: -1,
          },
          select: { id: true },
        });
        ledgerId = row.id;
      } else if (result.reservation) {
        await tx.sessionReservation.update({ where: { id: result.reservation.id }, data: { status: "RELEASED", releasedAt: now } });
      }
      await tx.sessionStudent.update({
        where: { sessionId_studentId: { sessionId: input.sessionId, studentId: input.studentId } },
        data: { attendanceStatus: input.outcome },
      });
      const resolution = await tx.attendanceResolution.create({
        data: {
          academyId: actor.academyId,
          sessionId: input.sessionId,
          studentId: input.studentId,
          outcome: input.outcome,
          reason: input.reason.trim(),
          resolvedById: actor.id,
          resolvedByRole: actor.role,
          subscriptionLedgerId: ledgerId,
        },
        select: { id: true, outcome: true, createdAt: true },
      });
      await enqueueAdminFlag(tx, actor.academyId, "ATTENDANCE_RESOLVED", `ATTENDANCE_RESOLVED:${resolution.id}`, {
        sessionId: input.sessionId,
        studentId: input.studentId,
      });
      return { resolution, effect: result.effect };
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}
