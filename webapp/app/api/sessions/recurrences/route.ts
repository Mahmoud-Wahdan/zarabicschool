import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { hasAvailableCredit, reserveCredit, runSerializable } from "../route";
import { recurringSessionSchema } from "../../../../lib/validation/management";

export async function POST(request: Request) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = recurringSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid recurring session details.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const start = new Date(data.scheduledStart);
  const end = new Date(data.scheduledEnd);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes <= 0 || durationMinutes > 720) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Session duration must be between 1 and 720 minutes." } }, { status: 400 });
  }
  if (data.sessionType === "PRIVATE" && data.studentIds.length !== 1) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Private sessions require exactly one student." } }, { status: 400 });
  }
  const studentIds = [...new Set(data.studentIds)];
  if (studentIds.length !== data.studentIds.length) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A student cannot be selected twice." } }, { status: 400 });
  }

  try {
    const result = await runSerializable(async (tx) => {
      const teacherSubject = await tx.teacherSubject.findFirst({
        where: { academyId: user.academyId, teacherId: data.teacherId, subjectId: data.subjectId },
      });
      const students = await tx.student.findMany({
        where: { id: { in: studentIds }, academyId: user.academyId, user: { isActive: true } },
        select: { id: true },
      });
      if (!teacherSubject || students.length !== studentIds.length) throw new Error("SESSION_PARTICIPANTS_INVALID");

      const series = await tx.recurrenceSeries.create({
        data: {
          academyId: user.academyId,
          teacherId: data.teacherId,
          subjectId: data.subjectId,
          sessionType: data.sessionType,
          timezone: data.timezone,
          startDate: start,
          totalWeeks: data.weekCount,
          recurrenceRule: {
            scheduledStart: data.scheduledStart,
            scheduledEnd: data.scheduledEnd,
            zoomJoinUrl: data.zoomJoinUrl,
            zoomHostUrl: data.zoomHostUrl || null,
            studentIds,
          },
          createdById: user.id,
        },
        select: { id: true },
      });

      const created = [];
      for (let index = 0; index < data.weekCount; index += 1) {
        const sessionStart = new Date(start.getTime() + index * 7 * 24 * 60 * 60 * 1000);
        const sessionEnd = new Date(end.getTime() + index * 7 * 24 * 60 * 60 * 1000);
        const everyStudentHasCredit = (await Promise.all(
          studentIds.map((studentId) => hasAvailableCredit(tx, user.academyId, studentId, sessionStart)),
        )).every(Boolean);
        if (!everyStudentHasCredit) {
          await tx.recurrenceSeries.update({
            where: { id: series.id },
            data: { generatedThroughWeek: index - 1, status: "PAUSED" },
          });
          break;
        }

        const session = await tx.session.create({
          data: {
            academyId: user.academyId,
            teacherId: data.teacherId,
            subjectId: data.subjectId,
            sessionType: data.sessionType,
            scheduledStart: sessionStart,
            scheduledEnd: sessionEnd,
            durationMinutes,
            timezone: data.timezone,
            zoomJoinUrl: data.zoomJoinUrl,
            zoomHostUrl: data.zoomHostUrl || null,
            recurrenceGroupId: series.id,
            recurrenceWeekIndex: index,
            createdById: user.id,
            students: { create: studentIds.map((studentId) => ({ studentId })) },
          },
          select: { id: true, scheduledStart: true },
        });
        for (const studentId of studentIds) {
          if (!(await reserveCredit(tx, user.academyId, studentId, session.id, sessionStart))) {
            throw new Error("INSUFFICIENT_SESSION_CREDIT");
          }
        }
        created.push(session);
        await tx.recurrenceSeries.update({
          where: { id: series.id },
          data: {
            generatedThroughWeek: index,
            status: index === data.weekCount - 1 ? "COMPLETED" : "ACTIVE",
          },
        });
      }
      return { seriesId: series.id, sessions: created };
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "INSUFFICIENT_SESSION_CREDIT") {
      return NextResponse.json({ error: { code: "INSUFFICIENT_SESSION_CREDIT", message: "One or more students do not have an available session credit." } }, { status: 409 });
    }
    if (cause instanceof Error && cause.message === "SESSION_PARTICIPANTS_INVALID") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Teacher, subject, or students are not valid for this academy." } }, { status: 409 });
    }
    throw cause;
  }
}
