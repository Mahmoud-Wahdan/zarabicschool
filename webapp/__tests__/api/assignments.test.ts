jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { GET as listAssignmentsRoute, POST as createAssignmentRoute } from "../../app/api/admin/assignments/route";
import { PATCH as updateAssignmentRoute } from "../../app/api/admin/assignments/[id]/route";
import { GET as needsTeacherRoute } from "../../app/api/admin/assignments/needs-teacher/route";
import { GET as teacherContextRoute } from "../../app/api/admin/teachers/[id]/context/route";
import { DELETE as deleteTeacherSubjectRoute } from "../../app/api/admin/teacher-subjects/route";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 3 — student/teacher assignments (database-backed)", () => {
  it("shows unassigned students with a StudentSubject in the needs-teacher list", async () => {
    asActor(fx.adminUserId);
    const response = await needsTeacherRoute();
    expect(response.status).toBe(200);
    const payload = await response.json();
    const entry = payload.data.find((item: { studentId: string }) => item.studentId === fx.studentProfileIds.student10);
    expect(entry).toBeDefined();
    expect(entry.subjectId).toBe(fx.subjectId);
    const assigned = payload.data.find((item: { studentId: string }) => item.studentId === fx.studentProfileIds.student1);
    expect(assigned).toBeUndefined();
  });

  it("forbids teachers and students from managing assignments", async () => {
    asActor(fx.teacherUserId);
    const forbiddenCreate = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student10,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
    }));
    expect(forbiddenCreate.status).toBe(403);

    asActor(fx.studentUserIds.student1);
    const forbiddenList = await listAssignmentsRoute(new Request("http://localhost:3000/api/admin/assignments"));
    expect(forbiddenList.status).toBe(403);
  });

  it("creates an assignment, rejects duplicates, and enforces one ACTIVE teacher per student+subject", async () => {
    asActor(fx.adminUserId);
    const created = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student10,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
    }));
    expect(created.status).toBe(201);
    const assignmentId = (await created.json()).data.id as string;

    const duplicateSameTeacher = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student10,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
    }));
    expect(duplicateSameTeacher.status).toBe(409);
    expect((await duplicateSameTeacher.json()).error?.code).toBe("DUPLICATE_ASSIGNMENT");

    const duplicateOtherTeacher = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student10,
      teacherId: fx.teacher2ProfileId,
      subjectId: fx.subjectId,
    }));
    expect(duplicateOtherTeacher.status).toBe(409);
    expect((await duplicateOtherTeacher.json()).error?.code).toBe("DUPLICATE_ASSIGNMENT");

    void assignmentId;
  });

  it("rejects assignments where the teacher does not teach the subject or the student is foreign", async () => {
    asActor(fx.adminUserId);
    const notTeaching = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student11,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectBId,
    }));
    expect(notTeaching.status).toBe(409);
    expect((await notTeaching.json()).error?.code).toBe("TEACHER_SUBJECT_NOT_ASSIGNED");

    const foreignStudent = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.foreignStudentProfileId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
    }));
    expect(foreignStudent.status).toBe(404);
  });

  it("ends an assignment (ENDED + ended_at) and then allows a new active one", async () => {
    asActor(fx.adminUserId);
    const list = await listAssignmentsRoute(new Request("http://localhost:3000/api/admin/assignments?status=ACTIVE"));
    const payload = await list.json();
    const active = payload.data.find((item: { studentId: string; teacherId: string }) =>
      item.studentId === fx.studentProfileIds.student10 && item.teacherId === fx.teacherProfileId);
    expect(active).toBeDefined();

    const ended = await updateAssignmentRoute(
      apiRequest(`/api/admin/assignments/${active.id}`, "PATCH", { action: "END", endedReason: "Switching teachers" }),
      routeParams(active.id),
    );
    expect(ended.status).toBe(200);
    const row = await prisma.studentTeacherAssignment.findUniqueOrThrow({ where: { id: active.id } });
    expect(row.status).toBe("ENDED");
    expect(row.endedAt).not.toBeNull();
    expect(row.endedReason).toBe("Switching teachers");

    const reEnd = await updateAssignmentRoute(
      apiRequest(`/api/admin/assignments/${active.id}`, "PATCH", { action: "END" }),
      routeParams(active.id),
    );
    expect(reEnd.status).toBe(409);

    const recreated = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student10,
      teacherId: fx.teacher2ProfileId,
      subjectId: fx.subjectId,
    }));
    expect(recreated.status).toBe(201);
    const newId = (await recreated.json()).data.id as string;

    const change = await updateAssignmentRoute(
      apiRequest(`/api/admin/assignments/${newId}`, "PATCH", { action: "CHANGE_TEACHER", newTeacherId: fx.teacherProfileId }),
      routeParams(newId),
    );
    expect(change.status).toBe(200);
    const changePayload = await change.json();
    const endedOld = await prisma.studentTeacherAssignment.findUniqueOrThrow({ where: { id: newId } });
    expect(endedOld.status).toBe("ENDED");
    const newActive = await prisma.studentTeacherAssignment.findUniqueOrThrow({ where: { id: changePayload.data.created.id } });
    expect(newActive.status).toBe("ACTIVE");
    expect(newActive.teacherId).toBe(fx.teacherProfileId);
    const rowsForPair = await prisma.studentTeacherAssignment.findMany({
      where: { studentId: fx.studentProfileIds.student10, subjectId: fx.subjectId },
    });
    expect(rowsForPair).toHaveLength(3);
    expect(rowsForPair.filter((item) => item.status === "ACTIVE")).toHaveLength(1);
  });

  it("rejects change-teacher when the new teacher does not teach the subject", async () => {
    asActor(fx.adminUserId);
    const list = await listAssignmentsRoute(new Request("http://localhost:3000/api/admin/assignments?status=ACTIVE"));
    const payload = await list.json();
    const active = payload.data.find((item: { studentId: string }) => item.studentId === fx.studentProfileIds.student10);
    expect(active).toBeDefined();
    const response = await updateAssignmentRoute(
      apiRequest(`/api/admin/assignments/${active.id}`, "PATCH", { action: "CHANGE_TEACHER", newTeacherId: fx.foreignTeacherProfileId }),
      routeParams(active.id),
    );
    expect(response.status).toBe(404);
  });

  it("exposes teacher context: subjects, busy SCHEDULED slots only, and assigned students", async () => {
    const busyStart = new Date();
    busyStart.setUTCDate(busyStart.getUTCDate() + 5);
    busyStart.setUTCHours(10, 0, 0, 0);
    await prisma.session.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: busyStart,
        scheduledEnd: new Date(busyStart.getTime() + 3600 * 1000),
        durationMinutes: 60,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/555444333222",
        createdById: fx.adminUserId,
        status: "SCHEDULED",
        students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
      },
      select: { id: true },
    });

    asActor(fx.adminUserId);
    const contextResponse = await teacherContextRoute(
      new Request("http://localhost:3000/api/admin/teachers/context"),
      routeParams(fx.teacherProfileId),
    );
    expect(contextResponse.status).toBe(200);
    const context = (await contextResponse.json()).data;
    expect(context.teacher.id).toBe(fx.teacherProfileId);
    expect(context.subjects.some((subject: { id: string }) => subject.id === fx.subjectId)).toBe(true);
    expect(context.subjects.some((subject: { id: string }) => subject.id === fx.subjectBId)).toBe(false);
    const group = context.assignedStudents.find((item: { subjectId: string }) => item.subjectId === fx.subjectId);
    expect(group.students.some((student: { studentId: string }) => student.studentId === fx.studentProfileIds.student1)).toBe(true);
    expect(group.students.some((student: { studentId: string }) => student.studentId === fx.studentProfileIds.student10)).toBe(true);
    expect(JSON.stringify(context)).not.toContain("zoom");

    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString();
    const filtered = await teacherContextRoute(
      new Request(`http://localhost:3000/api/admin/teachers/context?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      routeParams(fx.teacherProfileId),
    );
    const filteredData = (await filtered.json()).data;
    const busyCount = filteredData.busySlots.length;
    expect(busyCount).toBeGreaterThan(0);
    expect(filteredData.busySlots.every((slot: { status: string }) => slot.status === "SCHEDULED")).toBe(true);

    await prisma.session.updateMany({ where: { teacherId: fx.teacherProfileId }, data: { status: "CANCELLED" } });
    const afterCancel = await teacherContextRoute(
      new Request(`http://localhost:3000/api/admin/teachers/context?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      routeParams(fx.teacherProfileId),
    );
    expect(((await afterCancel.json()).data.busySlots as unknown[]).length).toBe(0);
  });

  it("blocks removing a teacher-subject link while assignment history references it", async () => {
    asActor(fx.adminUserId);
    const response = await deleteTeacherSubjectRoute(
      apiRequest("/api/admin/teacher-subjects", "DELETE", { teacherId: fx.teacherProfileId, subjectId: fx.subjectId }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error?.code).toBe("TEACHER_SUBJECT_IN_USE");
  });

  it("allows supervisors to manage assignments", async () => {
    asActor(fx.supervisorUserId);
    const created = await createAssignmentRoute(apiRequest("/api/admin/assignments", "POST", {
      studentId: fx.studentProfileIds.student11,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
    }));
    expect(created.status).toBe(201);
  });
});
