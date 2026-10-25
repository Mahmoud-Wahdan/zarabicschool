import type { Prisma } from "../../generated/prisma/client";

export class SchedulingValidationError extends Error {
  code: string;
  studentIds?: string[];

  constructor(code: string, message: string, studentIds?: string[]) {
    super(message);
    this.name = "SchedulingValidationError";
    this.code = code;
    this.studentIds = studentIds;
  }
}

export type ParticipantCheckOptions = {
  academyId: string;
  teacherId: string;
  subjectId: string;
  studentIds: string[];
  /** When set together with an Admin/Supervisor actor, a missing assignment is tolerated and logged on the created session. */
  assignmentOverrideReason?: string;
};

export type ResolvedParticipants = {
  studentIds: string[];
  overrodeAssignment: boolean;
};

/**
 * One shared transaction check for session scheduling:
 * teacher-subject link, active students, and (unless overridden) ACTIVE assignments.
 * The caller is responsible for mapping SchedulingValidationError to an HTTP response.
 */
export async function resolveParticipants(
  tx: Prisma.TransactionClient,
  options: ParticipantCheckOptions,
): Promise<ResolvedParticipants> {
  const teacherSubject = await tx.teacherSubject.findFirst({
    where: { academyId: options.academyId, teacherId: options.teacherId, subjectId: options.subjectId },
    select: { id: true },
  });
  if (!teacherSubject) {
    throw new SchedulingValidationError(
      "TEACHER_SUBJECT_NOT_ASSIGNED",
      "The selected teacher is not linked to the selected subject.",
    );
  }

  const uniqueStudentIds = [...new Set(options.studentIds)];
  const students = await tx.student.findMany({
    where: { id: { in: uniqueStudentIds }, academyId: options.academyId, user: { isActive: true } },
    select: { id: true },
  });
  const foundIds = new Set(students.map((student) => student.id));
  const missingIds = uniqueStudentIds.filter((studentId) => !foundIds.has(studentId));
  if (missingIds.length > 0) {
    throw new SchedulingValidationError(
      "STUDENT_NOT_FOUND_OR_INACTIVE",
      "One or more selected students were not found or are not active in this academy.",
      missingIds,
    );
  }

  const assignments = await tx.studentTeacherAssignment.findMany({
    where: {
      academyId: options.academyId,
      teacherId: options.teacherId,
      subjectId: options.subjectId,
      status: "ACTIVE",
      studentId: { in: uniqueStudentIds },
    },
    select: { studentId: true },
  });
  const assignedIds = new Set(assignments.map((assignment) => assignment.studentId));
  const unassignedIds = uniqueStudentIds.filter((studentId) => !assignedIds.has(studentId));

  if (unassignedIds.length > 0 && !options.assignmentOverrideReason) {
    throw new SchedulingValidationError(
      "STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT",
      "One or more students are not assigned to this teacher for this subject.",
      unassignedIds,
    );
  }

  return { studentIds: uniqueStudentIds, overrodeAssignment: unassignedIds.length > 0 };
}

/**
 * Only SCHEDULED sessions of the same teacher block a new slot.
 * CANCELLED and MISSED sessions never block; a session ending exactly when the new one
 * starts is allowed (strict inequalities).
 */
export async function assertTeacherFree(
  tx: Prisma.TransactionClient,
  academyId: string,
  teacherId: string,
  scheduledStart: Date,
  scheduledEnd: Date,
): Promise<void> {
  const conflicts = await tx.session.findMany({
    where: {
      academyId,
      teacherId,
      status: "SCHEDULED",
      scheduledStart: { lt: scheduledEnd },
      scheduledEnd: { gt: scheduledStart },
    },
    select: { id: true },
  });
  if (conflicts.length > 0) {
    throw new SchedulingValidationError(
      "TEACHER_TIME_CONFLICT",
      "The teacher already has a scheduled session overlapping this time.",
      undefined,
    );
  }
}
