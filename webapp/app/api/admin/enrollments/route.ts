import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { reserveCredit, runSerializable } from "../../../../lib/credits/reservation";
import { SchedulingValidationError, resolveParticipants } from "../../../../lib/scheduling/checks";
import { enrollmentSchema } from "../../../../lib/validation/management";

function schedulingErrorResponse(error: SchedulingValidationError) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.studentIds ? { studentIds: error.studentIds } : {}),
      },
    },
    { status: 409 },
  );
}

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = enrollmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session and student are required." } }, { status: 400 });
  const { sessionId, studentId, assignmentOverrideReason } = parsed.data;
  try {
    const enrollment = await runSerializable(async (tx) => {
      const session = await tx.session.findFirst({
        where: { id: sessionId, academyId: user.academyId, status: "SCHEDULED" },
        select: { id: true, teacherId: true, subjectId: true, scheduledStart: true },
      });
      if (!session) {
        throw new Error("SESSION_NOT_SCHEDULED");
      }
      await resolveParticipants(tx, {
        academyId: user.academyId,
        teacherId: session.teacherId,
        subjectId: session.subjectId,
        studentIds: [studentId],
        assignmentOverrideReason,
      });
      const created = await tx.sessionStudent.create({ data: { sessionId, studentId } });
      if (!(await reserveCredit(tx, user.academyId, studentId, sessionId, session.scheduledStart))) {
        throw new SchedulingValidationError(
          "INSUFFICIENT_SESSION_CREDIT",
          "The student does not have an available session credit.",
          [studentId],
        );
      }
      return created;
    });
    return NextResponse.json({ data: enrollment }, { status: 201 });
  } catch (cause) {
    if (cause instanceof SchedulingValidationError) {
      return schedulingErrorResponse(cause);
    }
    if (cause instanceof Error && cause.message === "SESSION_NOT_SCHEDULED") {
      return NextResponse.json({ error: { code: "SESSION_NOT_SCHEDULED", message: "Students can only be added to scheduled sessions." } }, { status: 409 });
    }
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Student is already enrolled in this session." } }, { status: 409 });
    }
    throw cause;
  }
}

export async function DELETE(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = enrollmentSchema.omit({ assignmentOverrideReason: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session and student are required." } }, { status: 400 });
  const { sessionId, studentId } = parsed.data;
  const session = await prisma.session.findFirst({ where: { id: sessionId, academyId: user.academyId }, select: { id: true } });
  if (!session) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Session not found." } }, { status: 404 });
  const deleted = await prisma.$transaction(async (tx) => {
    const removed = await tx.sessionStudent.deleteMany({ where: { sessionId, studentId } });
    if (removed.count > 0) {
      // Release the active reservation using the existing reservation lifecycle only.
      await tx.sessionReservation.updateMany({
        where: { sessionId, studentId, status: "RESERVED" },
        data: { status: "RELEASED", releasedAt: new Date() },
      });
    }
    return removed;
  });
  if (!deleted.count) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Enrollment not found." } }, { status: 404 });
  return NextResponse.json({ data: { removed: true, reservationReleased: true } });
}
