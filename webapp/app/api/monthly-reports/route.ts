import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client";

import { requireApiRole } from "../../../lib/dal";
import { currentMonthKey, isValidMonthKey } from "../../../lib/reports/month-key";
import {
  computeRescheduledSessions,
  eligibleMonthlyStudents,
  isMonthlyReportEditable,
} from "../../../lib/reports/monthly";
import { enqueueMonthlyReportSubmittedNotifications } from "../../../lib/reports/notifications";
import { isSession1ReportsReady } from "../../../lib/reports/session1-ready";
import { prisma } from "../../../lib/prisma";
import { monthlyReportSchema } from "../../../lib/validation/management";

/**
 * Teacher monthly report (Session 1 — CONTEXT §9, PROPOSAL until the owner
 * confirms): only the assigned teacher, per student, per month. NO money, NO
 * attendance, NO ledger, NO approval gate. Unique per (teacher, student,
 * month); only for a month that has started; editable for 7 days after
 * submission, then locked.
 */
export async function POST(request: Request) {
  const { user, error } = await requireApiRole("TEACHER");
  if (error) return error;

  if (!(await isSession1ReportsReady())) {
    return NextResponse.json(
      { error: { code: "MONTHLY_REPORTS_MIGRATION_PENDING", message: "Monthly reports arrive with the pending Session 1 migration. Ask the owner to apply it first." } },
      { status: 409 },
    );
  }

  const parsed = monthlyReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Please complete the monthly report.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const teacher = await prisma.teacher.findUniqueOrThrow({
    where: { userId: user.id },
    select: { id: true, academyId: true },
  });
  if (teacher.academyId !== user.academyId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher profile not found." } }, { status: 404 });
  }

  if (!isValidMonthKey(body.monthKey)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Month must be in YYYY-MM format.", fields: { monthKey: ["Invalid month."] } } },
      { status: 400 },
    );
  }
  // Only for a month that has STARTED (CONTEXT §9) — evaluated in the author's
  // local calendar, DST-safe.
  const currentMonth = currentMonthKey(user.timezone || "Africa/Cairo");
  if (body.monthKey > currentMonth) {
    return NextResponse.json(
      { error: { code: "MONTH_NOT_STARTED", message: "A monthly report can only be written for a month that has started.", fields: { monthKey: ["Future months are not allowed."] } } },
      { status: 409 },
    );
  }

  // Only for an eligible (teacher, student) pair: the student attended at least one
  // of this teacher's sessions in that month (same pair set the reminders use).
  const eligible = await eligibleMonthlyStudents(teacher.id, body.monthKey);
  if (!eligible.some((student) => student.studentId === body.studentId)) {
    return NextResponse.json(
      { error: { code: "NOT_ELIGIBLE", message: "This student has no sessions with you in the selected month." } },
      { status: 409 },
    );
  }

  // "Sessions rescheduled in the month" is COMPUTED from real data (replacement
  // sessions) — the client never sends it (CONTEXT §9).
  const rescheduledSessions = await computeRescheduledSessions(teacher.id, body.studentId, body.monthKey);
  const writeData = {
    achievement: body.achievement,
    learningProgress: body.learningProgress,
    classFocus: body.classFocus,
    homeworkCompletion: body.homeworkCompletion,
    punctuality: body.punctuality,
    supportAreas: body.supportAreas || null,
    nextMonthObjectives: body.nextMonthObjectives || null,
    language: body.language,
    rescheduledSessions,
  };

  const existing = await prisma.monthlyReport.findFirst({
    where: { teacherId: teacher.id, studentId: body.studentId, monthKey: body.monthKey },
    select: { id: true, submittedAt: true },
  });
  if (existing && !isMonthlyReportEditable(existing.submittedAt)) {
    // 7-day edit window (PROPOSAL): older reports lock.
    return NextResponse.json(
      { error: { code: "MONTHLY_REPORT_LOCKED", message: "This monthly report is locked — the 7-day edit window after submission has passed." } },
      { status: 409 },
    );
  }

  let report;
  try {
    if (existing) {
      // An edit inside the window keeps the original submittedAt (the window is
      // measured from the FIRST submission).
      report = await prisma.monthlyReport.update({
        where: { id: existing.id },
        data: writeData,
        select: { id: true, monthKey: true, studentId: true, teacherId: true, submittedAt: true, language: true },
      });
    } else {
      report = await prisma.monthlyReport.create({
        data: {
          academyId: user.academyId,
          teacherId: teacher.id,
          studentId: body.studentId,
          monthKey: body.monthKey,
          ...writeData,
        },
        select: { id: true, monthKey: true, studentId: true, teacherId: true, submittedAt: true, language: true },
      });
    }
  } catch (cause) {
    // A concurrent first submission hits the unique (teacher, student, month) index.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      return NextResponse.json(
        { error: { code: "MONTHLY_REPORT_EXISTS", message: "A monthly report already exists for this student and month." } },
        { status: 409 },
      );
    }
    throw cause;
  }

  // Submit-time delivery (CONTEXT §4A): the guardian + student are notified once
  // per report; edits inside the window never re-send (dedup). Best effort.
  try {
    await enqueueMonthlyReportSubmittedNotifications({ monthlyReportId: report.id });
  } catch {
    // Notification bookkeeping must never fail the submission.
  }

  return NextResponse.json({ data: report }, { status: existing ? 200 : 201 });
}
