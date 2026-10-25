import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import { reserveCredit } from "../credits/reservation";
import { prisma } from "../prisma";
import { enqueueSessionJobs } from "../notifications/session-jobs";
import { SchedulingValidationError, assertTeacherFree, resolveParticipants } from "./checks";

export type ReplacementSessionInput = {
  academyId: string;
  actorId: string;
  sourceSessionId: string;
  teacherId: string;
  subjectId: string;
  sessionType: "PRIVATE" | "GROUP";
  scheduledStart: Date;
  scheduledEnd: Date;
  timezone: string;
  zoomJoinUrl: string;
  zoomHostUrl?: string | null;
  studentIds: string[];
  assignmentOverrideReason?: string;
};

/**
 * The ONE replacement-creation service (Phase 3 replacement rules, now shared):
 * resolves participants (with the audited assignment-override path), asserts the
 * teacher is free, releases the source-session reservations of the students included
 * in the replacement, creates the session linked via `replacement_for_session_id`,
 * and reserves a credit per replacement student — all inside the caller's
 * transaction (runSerializable at the call sites). No money moves.
 */
export async function createReplacementSession(tx: Prisma.TransactionClient, input: ReplacementSessionInput) {
  const participants = await resolveParticipants(tx, {
    academyId: input.academyId,
    teacherId: input.teacherId,
    subjectId: input.subjectId,
    studentIds: input.studentIds,
    assignmentOverrideReason: input.assignmentOverrideReason,
  });
  await assertTeacherFree(tx, input.academyId, input.teacherId, input.scheduledStart, input.scheduledEnd);
  const replacementStudentIds = [...new Set(input.studentIds)];
  await tx.sessionReservation.updateMany({
    where: { sessionId: input.sourceSessionId, studentId: { in: replacementStudentIds }, status: "RESERVED" },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
  const created = await tx.session.create({
    data: {
      academyId: input.academyId,
      teacherId: input.teacherId,
      subjectId: input.subjectId,
      sessionType: input.sessionType,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      durationMinutes: Math.round((input.scheduledEnd.getTime() - input.scheduledStart.getTime()) / 60000),
      timezone: input.timezone,
      zoomJoinUrl: input.zoomJoinUrl,
      zoomHostUrl: input.zoomHostUrl || null,
      assignmentOverriddenById: participants.overrodeAssignment ? input.actorId : null,
      assignmentOverrideReason: participants.overrodeAssignment ? input.assignmentOverrideReason ?? null : null,
      replacementForSessionId: input.sourceSessionId,
      createdById: input.actorId,
      students: { create: replacementStudentIds.map((studentId) => ({ studentId })) },
    },
    select: { id: true, replacementForSessionId: true },
  });
  const insufficientStudentIds: string[] = [];
  for (const studentId of replacementStudentIds) {
    if (!(await reserveCredit(tx, input.academyId, studentId, created.id, input.scheduledStart))) {
      insufficientStudentIds.push(studentId);
    }
  }
  if (insufficientStudentIds.length > 0) {
    throw new SchedulingValidationError(
      "INSUFFICIENT_SESSION_CREDIT",
      "One or more students do not have an available session credit.",
      insufficientStudentIds,
    );
  }
  return created;
}

/**
 * Notification jobs for a freshly created replacement session (Phase 5 review F-12 —
 * replacements previously never got reminders). Called AFTER the scheduling
 * transaction commits; a failure here must never roll the replacement back.
 */
export async function enqueueReplacementJobs(replacementSessionId: string): Promise<void> {
  const session = await prisma.session.findFirst({
    where: { id: replacementSessionId },
    select: {
      id: true,
      academyId: true,
      scheduledStart: true,
      teacher: { select: { user: { select: { id: true } } } },
      students: { select: { student: { select: { userId: true, guardianId: true } } } },
    },
  });
  if (!session) return;
  const studentUserIds = session.students.map((entry) => entry.student.userId);
  const guardianProfileIds = [
    ...new Set(session.students.map((entry) => entry.student.guardianId).filter((id): id is string => id !== null)),
  ];
  const guardians = guardianProfileIds.length
    ? await prisma.guardian.findMany({ where: { id: { in: guardianProfileIds } }, select: { userId: true } })
    : [];
  await enqueueSessionJobs(
    prisma,
    session.academyId,
    session.id,
    session.scheduledStart,
    session.teacher.user.id,
    studentUserIds,
    guardians.map((guardian) => guardian.userId),
  );
}
