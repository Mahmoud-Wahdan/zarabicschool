import "server-only";

import { prisma } from "../prisma";

/**
 * S-07 roster changes (D18; owner approved Q1 as shown, 2026-10-29). Remove a student
 * from a GROUP session, under a lock on the session row:
 * - refused: session not in this academy (404), not SCHEDULED, PRIVATE (cancel the
 *   session instead), the student has a SUBMITTED/APPROVED report, or attendance
 *   already used the credit (reservation CONSUMED; owner answer A);
 * - then the roster row goes and the RESERVED reservation is RELEASED (the credit
 *   comes back by itself; no ledger row);
 * - the removed student, and their guardian when no other child of theirs stays on
 *   the roster, get a ROSTER_REMOVED notice (in-app + WhatsApp, no link; owner answer
 *   C); their PENDING notices for this session are cancelled.
 * Removing the last student is allowed (owner answer B).
 */
export type RosterResult = { ok: true } | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): RosterResult => ({ ok: false, status, code, message });

export async function removeStudentFromSession(actor: { academyId: string }, sessionId: string, studentId: string): Promise<RosterResult> {
  return prisma.$transaction(async (tx) => {
    const [session] = await tx.$queryRaw<{ id: string; session_type: string; status: string }[]>`
      SELECT id, session_type::text, status::text FROM sessions
       WHERE id = ${sessionId}::uuid AND academy_id = ${actor.academyId}::uuid
         FOR UPDATE`;
    if (!session) return fail(404, "NOT_FOUND", "Session not found.");
    if (session.status !== "SCHEDULED") return fail(409, "SESSION_NOT_SCHEDULED", "Students can only be removed from a scheduled session.");
    if (session.session_type === "PRIVATE") return fail(409, "PRIVATE_SESSION_CANCEL_INSTEAD", "A private session is cancelled instead of removing its student.");

    const report = await tx.report.findFirst({ where: { sessionId, studentId, status: { in: ["SUBMITTED", "APPROVED"] } }, select: { id: true } });
    if (report) return fail(409, "REPORT_EXISTS", "The student already has a report for this session.");
    const consumed = await tx.sessionReservation.findFirst({ where: { sessionId, studentId, status: "CONSUMED" }, select: { id: true } });
    if (consumed) return fail(409, "ATTENDANCE_SETTLED", "Attendance for this student was already settled.");

    const removed = await tx.sessionStudent.deleteMany({ where: { sessionId, studentId } });
    if (removed.count === 0) return fail(404, "NOT_FOUND", "Enrollment not found.");
    const now = new Date();
    await tx.sessionReservation.updateMany({ where: { sessionId, studentId, status: "RESERVED" }, data: { status: "RELEASED", releasedAt: now } });

    const student = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true, guardianId: true, guardian: { select: { userId: true } } } });
    const recipients = [student.userId];
    if (student.guardianId && student.guardian) {
      const otherChild = await tx.sessionStudent.count({ where: { sessionId, student: { guardianId: student.guardianId } } });
      if (otherChild === 0) recipients.push(student.guardian.userId);
      else {
        // The guardian still has a child in this session: keep their reminders, still tell them.
        await tx.notificationJob.create({ data: removalNotice(actor.academyId, sessionId, student.guardian.userId, studentId, now) });
      }
    }
    await tx.notificationJob.updateMany({
      where: { sessionId, recipientUserId: { in: recipients }, status: "PENDING", kind: { not: "ROSTER_REMOVED" } },
      data: { status: "CANCELLED", lastError: "Removed from the session roster." },
    });
    await tx.notificationJob.createMany({ data: recipients.map((userId) => removalNotice(actor.academyId, sessionId, userId, studentId, now)), skipDuplicates: true });
    return { ok: true } as const;
  });
}

function removalNotice(academyId: string, sessionId: string, recipientUserId: string, studentId: string, now: Date) {
  return {
    academyId, sessionId, recipientUserId, kind: "ROSTER_REMOVED",
    dedupKey: `ROSTER_REMOVED:${sessionId}:${studentId}:${recipientUserId}`, scheduledFor: now,
    payload: { studentId },
  };
}
