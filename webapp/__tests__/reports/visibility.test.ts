import { getReportForViewer, type Viewer } from "../../lib/reports/visibility";
import { getMonthlyReportForViewer } from "../../lib/reports/monthly";
import { currentMonthKey, previousMonthKey, monthKeyRangeUtc } from "../../lib/reports/month-key";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

jest.setTimeout(180_000);

let fx: SessionFixtures;

const currentMonth = currentMonthKey("UTC");
const previousMonth = previousMonthKey(currentMonth);

function viewerFor(role: Viewer["role"], userId: string): Viewer {
  return { userId, academyId: fx.academyId, role };
}

/** Past SCHEDULED session (visibility-on-submit applies in every status). */
async function createPastSession(studentProfileId: string, teacherProfileId = fx.teacherProfileId) {
  const end = new Date(Date.now() - 10 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(end.getTime() - 60 * 60 * 1000),
      scheduledEnd: end,
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234",
      createdById: fx.adminUserId,
      status: "SCHEDULED",
      students: { create: [{ studentId: studentProfileId }] },
    },
    select: { id: true },
  });
}

async function createReportRow(sessionId: string, studentId: string, teacherProfileId = fx.teacherProfileId) {
  return prisma.report.create({
    data: {
      academyId: fx.academyId,
      sessionId,
      studentId,
      teacherId: teacherProfileId,
      reportType: "SESSION_COMPLETION_REPORT",
      status: "SUBMITTED",
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Full summary visible only to allowed viewers.",
      homework: "Practice page 12.",
      notes: "Private note text.",
      operationalEvents: { late_entry_minutes: 5 },
      extraTimeMinutes: 10,
      language: "fr",
    },
    select: { id: true },
  });
}

/** An adult student without a guardian inside the main academy (the fixture students all have guardians). */
async function createAdultStudent(suffix: string) {
  const user = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_adult_${suffix}`,
      displayName: "Demo Test Visibility Adult",
      passwordHash: "x".repeat(60),
      role: "STUDENT",
      phone: "+201000000042",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  const student = await prisma.student.create({
    data: { userId: user.id, academyId: fx.academyId, guardianId: null, isAdult: true, enrollmentDate: new Date() },
    select: { id: true },
  });
  return { userId: user.id, studentId: student.id };
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) {
    await prisma.monthlyReport.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await cleanupSessionFixtures(fx);
  }
  await closePrisma();
});

describe("Session 1 — visibility rules (lib/reports/visibility + lib/reports/monthly)", () => {
  it("UNIT-VIS-01: guardian, admin and supervisor get 100% of the session report fields and never any money field", async () => {
    const session = await createPastSession(fx.studentProfileIds.student1);
    const report = await createReportRow(session.id, fx.studentProfileIds.student1);

    for (const [role, userId] of [
      ["ADMIN", fx.adminUserId],
      ["SUPERVISOR", fx.supervisorUserId],
      ["GUARDIAN", fx.guardianUserId],
    ] as const) {
      const view = await getReportForViewer(viewerFor(role, userId), session.id, fx.studentProfileIds.student1);
      expect(view?.id).toBe(report.id);
      expect(view?.status).toBe("SUBMITTED");
      expect(view?.classRemark).toBe("good");
      expect(view?.summary).toBe("Full summary visible only to allowed viewers.");
      expect(view?.homework).toBe("Practice page 12.");
      expect(view?.notes).toBe("Private note text.");
      expect(view?.operationalEvents).toEqual({ late_entry_minutes: 5 });
      expect(view?.extraTimeMinutes).toBe(10);
      expect(view?.language).toBe("fr");
      // Reports carry no money fields for any role (CONTEXT §9).
      const serialized = JSON.stringify(view).toLowerCase();
      for (const token of ["amount", "amountminor", "payroll", "salary", "wage", "rate_snapshot"]) {
        expect(serialized).not.toContain(token);
      }
    }
  });

  it("UNIT-VIS-02: a student WITH a guardian sees homework, notes and attachments only — remark, summary, ratings omitted", async () => {
    const session = await createPastSession(fx.studentProfileIds.student2);
    await createReportRow(session.id, fx.studentProfileIds.student2);
    const view = await getReportForViewer(
      viewerFor("STUDENT", fx.studentUserIds.student2),
      session.id,
      fx.studentProfileIds.student2,
    );
    expect(view).not.toBeNull();
    expect(view?.homework).toBe("Practice page 12.");
    expect(view?.notes).toBe("Private note text.");
    expect(view?.attachments).toEqual([]);
    expect(view?.classRemark).toBeNull();
    expect(view?.summary).toBeNull();
    expect(view?.operationalEvents).toBeNull();
    expect(view?.extraTimeMinutes).toBeNull();
    expect(view?.extraTimeStatus).toBeNull();
    expect(view?.rejectionReason).toBeNull();
  });

  it("UNIT-VIS-03: a student WITH a guardian sees ONLY next month's objectives from a monthly report; the guardian sees everything", async () => {
    const { start } = monthKeyRangeUtc(previousMonth);
    const monthly = await prisma.monthlyReport.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        studentId: fx.studentProfileIds.student3,
        monthKey: previousMonth,
        achievement: "Full achievement text.",
        learningProgress: "EXCELLENT",
        classFocus: "OFTEN",
        homeworkCompletion: "MOST_OF_THE_TIME",
        punctuality: "ALWAYS",
        rescheduledSessions: 2,
        supportAreas: "Needs help with tajweed rules.",
        nextMonthObjectives: "Objectives for next month.",
        language: "en",
        submittedAt: new Date(start.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    const studentView = await getMonthlyReportForViewer(
      viewerFor("STUDENT", fx.studentUserIds.student3),
      fx.studentProfileIds.student3,
      previousMonth,
    );
    expect(studentView?.id).toBe(monthly.id);
    expect(studentView?.nextMonthObjectives).toBe("Objectives for next month.");
    expect(studentView?.achievement).toBeNull();
    expect(studentView?.learningProgress).toBeNull();
    expect(studentView?.classFocus).toBeNull();
    expect(studentView?.homeworkCompletion).toBeNull();
    expect(studentView?.punctuality).toBeNull();
    expect(studentView?.supportAreas).toBeNull();
    expect(studentView?.rescheduledSessions).toBe(0);
    expect(studentView?.editable).toBe(false);

    const guardianView = await getMonthlyReportForViewer(
      viewerFor("GUARDIAN", fx.guardianUserId),
      fx.studentProfileIds.student3,
      previousMonth,
    );
    expect(guardianView?.achievement).toBe("Full achievement text.");
    expect(guardianView?.supportAreas).toBe("Needs help with tajweed rules.");
    expect(guardianView?.nextMonthObjectives).toBe("Objectives for next month.");
  });

  it("UNIT-VIS-04: an adult student without a guardian sees the full session report and the full monthly report", async () => {
    const adult = await createAdultStudent(`${fx.suffix}vis04`);
    const session = await createPastSession(adult.studentId);
    await createReportRow(session.id, adult.studentId);
    const view = await getReportForViewer(viewerFor("STUDENT", adult.userId), session.id, adult.studentId);
    expect(view?.summary).toBe("Full summary visible only to allowed viewers.");
    expect(view?.classRemark).toBe("good");
    expect(view?.notes).toBe("Private note text.");

    await prisma.monthlyReport.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        studentId: adult.studentId,
        monthKey: previousMonth,
        achievement: "Adult full achievement.",
        learningProgress: "GOOD",
        classFocus: "OFTEN",
        homeworkCompletion: "SOMETIMES",
        punctuality: "OFTEN",
        supportAreas: "Adult support areas.",
        nextMonthObjectives: "Adult objectives.",
        language: "en",
      },
    });
    const monthlyView = await getMonthlyReportForViewer(viewerFor("STUDENT", adult.userId), adult.studentId, previousMonth);
    expect(monthlyView?.achievement).toBe("Adult full achievement.");
    expect(monthlyView?.supportAreas).toBe("Adult support areas.");
    expect(monthlyView?.nextMonthObjectives).toBe("Adult objectives.");
  });

  it("UNIT-VIS-05: a teacher never sees another teacher's report (null, no existence leak)", async () => {
    const session = await createPastSession(fx.studentProfileIds.student5);
    await createReportRow(session.id, fx.studentProfileIds.student5, fx.teacherProfileId);
    // Teacher 2 is in the same academy but is not this report's teacher.
    const otherTeacherView = await getReportForViewer(
      viewerFor("TEACHER", fx.teacher2UserId),
      session.id,
      fx.studentProfileIds.student5,
    );
    expect(otherTeacherView).toBeNull();
    // The report's own teacher still sees it (needed to fix a rejected report).
    const ownTeacherView = await getReportForViewer(
      viewerFor("TEACHER", fx.teacherUserId),
      session.id,
      fx.studentProfileIds.student5,
    );
    expect(ownTeacherView?.summary).toBe("Full summary visible only to allowed viewers.");
  });

  it("UNIT-VIS-06: evaluations content exists on no report view for any non-admin role (Admin-only per CONTEXT §9)", async () => {
    const session = await createPastSession(fx.studentProfileIds.student6);
    await createReportRow(session.id, fx.studentProfileIds.student6);
    const nonAdminRoles: [Viewer["role"], string][] = [
      ["SUPERVISOR", fx.supervisorUserId],
      ["TEACHER", fx.teacherUserId],
      ["STUDENT", fx.studentUserIds.student6],
      ["GUARDIAN", fx.guardianUserId],
    ];
    for (const [role, userId] of nonAdminRoles) {
      const view = await getReportForViewer(viewerFor(role, userId), session.id, fx.studentProfileIds.student6);
      expect(view).not.toBeNull();
      // The view type carries no evaluation fields for anyone; assert the exact key
      // set so an evaluation field added later for non-admin roles breaks this test.
      expect(Object.keys(view ?? {}).sort()).toEqual(
        [
          "approvedAt",
          "attachments",
          "attendanceOutcome",
          "classRemark",
          "homework",
          "id",
          "language",
          "notes",
          "operationalEvents",
          "extraTimeMinutes",
          "extraTimeStatus",
          "rejectionReason",
          "sessionId",
          "status",
          "studentId",
          "submittedAt",
          "summary",
          "teacherId",
        ].sort(),
      );
    }
  });
});
