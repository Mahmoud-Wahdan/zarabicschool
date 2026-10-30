import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "../../../../lib/prisma";

import { requireApiRoles } from "../../../../lib/dal";
import { reserveCredit, runSerializable } from "../../../../lib/credits/reservation";
import { removeStudentFromSession } from "../../../../lib/scheduling/roster";
import { SchedulingValidationError, resolveParticipants } from "../../../../lib/scheduling/checks";
import { enrollmentSchema } from "../../../../lib/validation/management";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";

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

const candidatesQuery = z.object({ sessionId: z.string().uuid() });

/**
 * The chosen session's students only (owner, 2026-10-30): `enrolled` (can be removed)
 * and `available` (an ACTIVE assignment to the session's teacher and subject, an active
 * account, not already enrolled). ADMIN and SUPERVISOR; ids and names only.
 */
export async function GET(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = candidatesQuery.safeParse({ sessionId: new URL(request.url).searchParams.get("sessionId") });
  if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "A valid session id is required.");
  const session = await prisma.session.findFirst({
    where: { id: parsed.data.sessionId, academyId: user.academyId },
    select: { teacherId: true, subjectId: true, students: { select: { studentId: true } } },
  });
  if (!session) return errorResponse(404, "NOT_FOUND", "Session not found.");
  const enrolledIds = session.students.map((row) => row.studentId);
  const select = { id: true, user: { select: { displayName: true } } } as const;
  const [enrolled, available] = await Promise.all([
    prisma.student.findMany({ where: { academyId: user.academyId, id: { in: enrolledIds } }, select, orderBy: { user: { displayName: "asc" } } }),
    prisma.student.findMany({
      where: {
        academyId: user.academyId,
        id: { notIn: enrolledIds },
        user: { isActive: true },
        assignments: { some: { academyId: user.academyId, teacherId: session.teacherId, subjectId: session.subjectId, status: "ACTIVE" } },
      },
      select,
      orderBy: { user: { displayName: "asc" } },
    }),
  ]);
  const names = (rows: typeof enrolled) => rows.map((row) => ({ id: row.id, displayName: row.user.displayName }));
  return NextResponse.json({ data: { enrolled: names(enrolled), available: names(available) } }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = enrollmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session and student are required." } }, { status: 400 });
  const { sessionId, studentId, assignmentOverrideReason } = parsed.data;
  try {
    const enrollment = await runSerializable(async (tx) => {
      // S-07 (Q2): the same session-row lock as a removal, so add/remove never race.
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid AND academy_id = ${user.academyId}::uuid FOR UPDATE`;
      const session = await tx.session.findFirst({
        where: { id: sessionId, academyId: user.academyId, status: "SCHEDULED" },
        select: { id: true, teacherId: true, subjectId: true, scheduledStart: true, scheduledEnd: true, sessionType: true, _count: { select: { students: true } } },
      });
      if (!session) {
        throw new Error("SESSION_NOT_SCHEDULED");
      }
      // Owner Q16 (2026-10-27): a session that already ended (still SCHEDULED because
      // its reports are not all in) never gains a student afterwards.
      if (session.scheduledEnd.getTime() <= Date.now()) {
        throw new Error("SESSION_ALREADY_ENDED");
      }
      // D18: students are added on GROUP sessions; a PRIVATE session has one student.
      if (session.sessionType === "PRIVATE" && session._count.students >= 1) {
        throw new Error("PRIVATE_SESSION_FULL");
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
    if (cause instanceof Error && cause.message === "SESSION_ALREADY_ENDED") {
      return NextResponse.json({ error: { code: "SESSION_ALREADY_ENDED", message: "Students cannot be added to a session that has already ended." } }, { status: 409 });
    }
    if (cause instanceof Error && cause.message === "PRIVATE_SESSION_FULL") {
      return NextResponse.json({ error: { code: "PRIVATE_SESSION_FULL", message: "A private session already has its student." } }, { status: 409 });
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
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = enrollmentSchema.omit({ assignmentOverrideReason: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session and student are required." } }, { status: 400 });
  const { sessionId, studentId } = parsed.data;
  // S-07 (D18): GROUP only, under a session lock; blocked by a report or settled attendance.
  const result = await removeStudentFromSession(user, sessionId, studentId);
  if (!result.ok) return errorResponse(result.status, result.code, result.message);
  return NextResponse.json({ data: { removed: true, reservationReleased: true } });
}
