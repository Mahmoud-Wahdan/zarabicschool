jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { getReportForViewer } from "../../lib/reports/visibility";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import { __setStorageProviderForTests } from "../../lib/storage";
import { isAttachmentsReady } from "../../lib/storage/attachment-ready";
import { FakeStorageProvider, FlakyStorageProvider } from "../../lib/storage/fake-storage";
import { MAX_ATTACHMENT_BYTES } from "../../lib/storage/mime";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { GET as listAttachmentsRoute, POST as uploadAttachmentsRoute } from "../../app/api/reports/[id]/attachments/route";
import { GET as signedUrlRoute } from "../../app/api/reports/[id]/attachments/[attachmentId]/route";
import { GET as getRemarksRoute, PUT as putRemarksRoute } from "../../app/api/admin/settings/class-remarks/route";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;
const storage = new FakeStorageProvider();
let attachmentsReady = false;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function pngBytes(): Buffer {
  // Minimal PNG signature + payload — enough for the magic-byte check.
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
}

function formDataWithFiles(files: { name: string; bytes: Buffer; type: string }[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  }
  return new Request("http://localhost:3000/upload", { method: "POST", body: form });
}

async function createPastSession(studentProfileId: string, minutesAgoEnded = 30) {
  const end = new Date(Date.now() - minutesAgoEnded * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
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

async function submitReport(sessionId: string, studentId: string, actorId = fx.teacherUserId) {
  asActor(actorId);
  const response = await submitReportRoute(
    apiRequest(`/api/sessions/${sessionId}/students/${studentId}/report`, "POST", {
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Covered the lesson content.",
      homework: "Practice page 12.",
    }),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function approveReport(reportId: string, actorId = fx.adminUserId) {
  asActor(actorId);
  const review = await reviewReportRoute(apiRequest(`/api/reports/${reportId}/review`, "POST", { action: "APPROVE" }), {
    params: Promise.resolve({ id: reportId }),
  });
  return { status: review.status, body: await review.json() };
}

async function uploadFile(reportId: string, actorId: string, files: { name: string; bytes: Buffer; type: string }[]) {
  asActor(actorId);
  const response = await uploadAttachmentsRoute(formDataWithFiles(files), { params: Promise.resolve({ id: reportId }) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  __setStorageProviderForTests(storage);
  fx = await createSessionFixtures();
  // An adult student without a guardian in the MAIN academy (CONTEXT §9 full-report case).
  const adultUser = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_adult_${fx.suffix}`,
      displayName: "Demo Test Adult Student",
      passwordHash: "x".repeat(60),
      role: "STUDENT",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  const adultStudent = await prisma.student.create({
    data: { userId: adultUser.id, academyId: fx.academyId, isAdult: true, enrollmentDate: new Date() },
    select: { id: true },
  });
  fx.studentUserIds.adult = adultUser.id;
  fx.studentProfileIds.adult = adultStudent.id;
  attachmentsReady = await isAttachmentsReady();
  if (!attachmentsReady) {
    console.warn(
      "[phase5-test] PENDING MIGRATION — report_attachments/academy_settings not applied yet (20261015093512). Attachment tests assert migration-pending behavior and activate fully once the owner applies the migration.",
    );
  }
});

afterAll(async () => {
  __setStorageProviderForTests(null);
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 5 Batch A — report visibility (database-backed)", () => {
  it("gives a student with a guardian ONLY homework, notes and attachments", async () => {
    const session = await createPastSession(fx.studentProfileIds.student1);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student1);
    expect(submitted.status).toBe(201);
    const approved = await approveReport(submitted.body.data.id);
    expect(approved.status).toBe(200);

    const view = await getReportForViewer(
      { userId: fx.studentUserIds.student1, academyId: fx.academyId, role: "STUDENT" },
      session.id,
      fx.studentProfileIds.student1,
    );
    expect(view).not.toBeNull();
    expect(view!.homework).toBe("Practice page 12.");
    expect(view!.classRemark).toBeNull();
    expect(view!.summary).toBeNull();
    expect(view!.operationalEvents).toBeNull();
    expect(view!.extraTimeMinutes).toBeNull();
    expect(view!.extraTimeStatus).toBeNull();
  });

  it("gives an adult student without a guardian the full report", async () => {
    const session = await createPastSession(fx.studentProfileIds.adult);
    const submitted = await submitReport(session.id, fx.studentProfileIds.adult);
    expect(submitted.status).toBe(201);
    const approved = await approveReport(submitted.body.data.id);
    expect(approved.status).toBe(200);

    const view = await getReportForViewer(
      { userId: fx.studentUserIds.adult, academyId: fx.academyId, role: "STUDENT" },
      session.id,
      fx.studentProfileIds.adult,
    );
    expect(view).not.toBeNull();
    expect(view!.classRemark).toBe("good");
    expect(view!.summary).toBe("Covered the lesson content.");
    expect(view!.homework).toBe("Practice page 12.");
  });

  it("gives the linked guardian the full report and hides it from everyone else", async () => {
    const session = await createPastSession(fx.studentProfileIds.student2);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student2);
    const approved = await approveReport(submitted.body.data.id);
    expect(approved.status).toBe(200);

    const guardianView = await getReportForViewer(
      { userId: fx.guardianUserId, academyId: fx.academyId, role: "GUARDIAN" },
      session.id,
      fx.studentProfileIds.student2,
    );
    expect(guardianView).not.toBeNull();
    expect(guardianView!.summary).toBe("Covered the lesson content.");

    // Existence never leaks: a foreign academy admin and an unrelated teacher get null.
    const foreignAdminView = await getReportForViewer(
      { userId: fx.foreignAdminUserId, academyId: fx.foreignAcademyId, role: "ADMIN" },
      session.id,
      fx.studentProfileIds.student2,
    );
    expect(foreignAdminView).toBeNull();
    const otherTeacherView = await getReportForViewer(
      { userId: fx.teacher2UserId, academyId: fx.academyId, role: "TEACHER" },
      session.id,
      fx.studentProfileIds.student2,
    );
    expect(otherTeacherView).toBeNull();
  });

  it("hides unapproved reports from students and guardians but shows them to the teacher", async () => {
    const session = await createPastSession(fx.studentProfileIds.student3);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student3);
    expect(submitted.status).toBe(201);

    const studentView = await getReportForViewer(
      { userId: fx.studentUserIds.student3, academyId: fx.academyId, role: "STUDENT" },
      session.id,
      fx.studentProfileIds.student3,
    );
    expect(studentView).toBeNull();
    const guardianView = await getReportForViewer(
      { userId: fx.guardianUserId, academyId: fx.academyId, role: "GUARDIAN" },
      session.id,
      fx.studentProfileIds.student3,
    );
    expect(guardianView).toBeNull();
    const teacherView = await getReportForViewer(
      { userId: fx.teacherUserId, academyId: fx.academyId, role: "TEACHER" },
      session.id,
      fx.studentProfileIds.student3,
    );
    expect(teacherView).not.toBeNull();

    // The API route answers with the generic 404, never a 403 existence oracle.
    asActor(fx.studentUserIds.student3);
    const apiResponse = await listAttachmentsRoute(apiRequest(`/api/reports/${submitted.body.data.id}/attachments`, "GET"), {
      params: Promise.resolve({ id: submitted.body.data.id }),
    });
    expect(apiResponse.status).toBe(404);
  });
});

describe("Phase 5 Batch A — class remark list (database-backed)", () => {
  it("validates the class remark against the academy's list on submit", async () => {
    const session = await createPastSession(fx.studentProfileIds.student4);
    asActor(fx.teacherUserId);
    const bad = await submitReportRoute(
      apiRequest(`/api/sessions/${session.id}/students/${fx.studentProfileIds.student4}/report`, "POST", {
        attendanceOutcome: "ATTENDED",
        classRemark: "outstanding!!!",
        summary: "Covered the lesson content.",
        homework: "Practice page 12.",
      }),
      { params: Promise.resolve({ id: session.id, studentId: fx.studentProfileIds.student4 }) },
    );
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.error.fields.classRemark).toBeDefined();

    const good = await submitReport(session.id, fx.studentProfileIds.student4);
    expect(good.status).toBe(201);
  });

  it("lets an Admin change the list and enforces it on new submissions", async () => {
    asActor(fx.adminUserId);
    const put = await putRemarksRoute(
      apiRequest("/api/admin/settings/class-remarks", "PUT", { items: ["ممتاز", "جيد", "مقبول", "يحتاج متابعة"] }),
    );
    const putBody = await put.json();
    if (!attachmentsReady) {
      // academy_settings arrives with the same owner-applied migration.
      expect(put.status).toBe(409);
      expect(putBody.error.code).toBe("ATTACHMENTS_MIGRATION_PENDING");
      console.warn("[phase5-test] PENDING MIGRATION — admin remark-list editing assertions deferred until 20261015093512 is applied.");
    } else {
      expect(put.status).toBe(200);
      expect(putBody.data.items).toEqual(["ممتاز", "جيد", "مقبول", "يحتاج متابعة"]);
    }

    // Supervisor is excluded from system settings (owner decision 2026-10-14) — the role
    // gate fires before any storage/readiness check.
    asActor(fx.supervisorUserId);
    const supervisorPut = await putRemarksRoute(
      apiRequest("/api/admin/settings/class-remarks", "PUT", { items: ["x", "y"] }),
    );
    expect(supervisorPut.status).toBe(403);
    const supervisorGet = await getRemarksRoute();
    expect(supervisorGet.status).toBe(403);

    if (!attachmentsReady) return;

    // Admin changed the list: the English default now fails, the Arabic item passes.
    const session = await createPastSession(fx.studentProfileIds.student5);
    asActor(fx.teacherUserId);
    const withEnglishRemark = await submitReportRoute(
      apiRequest(`/api/sessions/${session.id}/students/${fx.studentProfileIds.student5}/report`, "POST", {
        attendanceOutcome: "ATTENDED",
        classRemark: "good",
        summary: "Covered the lesson content.",
        homework: "Practice page 12.",
      }),
      { params: Promise.resolve({ id: session.id, studentId: fx.studentProfileIds.student5 }) },
    );
    expect(withEnglishRemark.status).toBe(400);
    const withArabicRemark = await submitReportRoute(
      apiRequest(`/api/sessions/${session.id}/students/${fx.studentProfileIds.student5}/report`, "POST", {
        attendanceOutcome: "ATTENDED",
        classRemark: "جيد",
        summary: "Covered the lesson content.",
        homework: "Practice page 12.",
      }),
      { params: Promise.resolve({ id: session.id, studentId: fx.studentProfileIds.student5 }) },
    );
    expect(withArabicRemark.status).toBe(201);

    // Restore the default list for the rest of the run (settings are per academy).
    asActor(fx.adminUserId);
    await putRemarksRoute(
      apiRequest("/api/admin/settings/class-remarks", "PUT", { items: ["excellent", "good", "acceptable", "needs follow-up"] }),
    );
  });
});

describe("Phase 5 Batch A — report attachments (database-backed, storage faked)", () => {
  it("answers the migration-pending conflict until the owner applies 20261015093512", async () => {
    const session = await createPastSession(fx.studentProfileIds.student6);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student6);
    expect(submitted.status).toBe(201);
    const upload = await uploadFile(submitted.body.data.id, fx.teacherUserId, [
      { name: "notes.png", bytes: pngBytes(), type: "image/png" },
    ]);
    if (!attachmentsReady) {
      expect(upload.status).toBe(409);
      expect(upload.body.error.code).toBe("ATTACHMENTS_MIGRATION_PENDING");
      return;
    }
    expect(upload.status).toBe(201);
  });

  it("uploads to a server-generated path and signs short-lived URLs for authorized viewers", async () => {
    if (!attachmentsReady) {
      console.warn("[phase5-test] PENDING MIGRATION — skipping the full attachment matrix.");
      return;
    }
    // Report stays editable: submit -> upload while SUBMITTED -> approve -> student reads.
    const session = await createPastSession(fx.studentProfileIds.student7);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student7);
    const reportId = submitted.body.data.id;

    const upload = await uploadFile(reportId, fx.teacherUserId, [
      { name: "C:\\evil\\path..\\\\my homework page.PNG", bytes: pngBytes(), type: "image/png" },
    ]);
    expect(upload.status).toBe(201);
    const rows = await prisma.reportAttachment.findMany({ where: { reportId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].originalName).toBe("my homework page.PNG");
    expect(rows[0].filePath).not.toContain("my homework");
    expect(rows[0].filePath.startsWith(`${fx.academyId}/${reportId}/`)).toBe(true);
    expect(storage.objects.has(rows[0].filePath)).toBe(true);

    const approved = await approveReport(reportId);
    expect(approved.status).toBe(200);

    // Teacher signs; the student (with guardian) sees attachments per CONTEXT §9.
    asActor(fx.teacherUserId);
    const teacherSigned = await signedUrlRoute(apiRequest(`/api/reports/${reportId}/attachments/${rows[0].id}`, "GET"), {
      params: Promise.resolve({ id: reportId, attachmentId: rows[0].id }),
    });
    expect(teacherSigned.status).toBe(200);
    const teacherBody = await teacherSigned.json();
    expect(teacherBody.data.url).toContain(encodeURIComponent(rows[0].filePath));
    expect(teacherBody.data.expiresInSeconds).toBe(300);

    asActor(fx.studentUserIds.student7);
    const studentSigned = await signedUrlRoute(apiRequest(`/api/reports/${reportId}/attachments/${rows[0].id}`, "GET"), {
      params: Promise.resolve({ id: reportId, attachmentId: rows[0].id }),
    });
    expect(studentSigned.status).toBe(200);

    // An unrelated student never reaches it (generic 404, no existence leak).
    asActor(fx.studentUserIds.student8);
    const strangerSigned = await signedUrlRoute(apiRequest(`/api/reports/${reportId}/attachments/${rows[0].id}`, "GET"), {
      params: Promise.resolve({ id: reportId, attachmentId: rows[0].id }),
    });
    expect(strangerSigned.status).toBe(404);
  });

  it("rejects spoofed MIME, oversized files, and non-owner teachers; compensates failed DB writes", async () => {
    if (!attachmentsReady) {
      console.warn("[phase5-test] PENDING MIGRATION — skipping the full attachment matrix.");
      return;
    }
    const session = await createPastSession(fx.studentProfileIds.student9);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student9);
    const reportId = submitted.body.data.id;

    const spoofed = await uploadFile(reportId, fx.teacherUserId, [
      { name: "invoice.pdf", bytes: Buffer.from("definitely not a pdf, just text"), type: "application/pdf" },
    ]);
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.error.code).toBe("INVALID_ATTACHMENT_TYPE");

    const oversized = await uploadFile(reportId, fx.teacherUserId, [
      { name: "big.png", bytes: Buffer.concat([pngBytes(), Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1)]), type: "image/png" },
    ]);
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("ATTACHMENT_TOO_LARGE");

    const foreign = await uploadFile(reportId, fx.foreignTeacherUserId, [
      { name: "notes.png", bytes: pngBytes(), type: "image/png" },
    ]);
    expect(foreign.status).toBe(404);

    // Compensation (request-atomic): the SECOND upload fails -> the rows created by
    // this request are deleted and every object it uploaded is removed — neither
    // orphan DB rows nor orphan objects survive.
    const flaky = new FlakyStorageProvider(2);
    __setStorageProviderForTests(flaky);
    try {
      await uploadFile(reportId, fx.teacherUserId, [
        { name: "one.png", bytes: pngBytes(), type: "image/png" },
        { name: "two.png", bytes: pngBytes(), type: "image/png" },
      ]);
      throw new Error("expected the flaky upload to reject");
    } catch (cause) {
      expect((cause as Error).message).toBe("storage unavailable");
    } finally {
      __setStorageProviderForTests(storage);
    }
    expect(flaky.removedPaths.length).toBeGreaterThanOrEqual(1);
    const survivors = await prisma.reportAttachment.findMany({ where: { reportId } });
    expect(survivors).toHaveLength(0);
    expect(flaky.objects.size).toBe(0);
  });
});
