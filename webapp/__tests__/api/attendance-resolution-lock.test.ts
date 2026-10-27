jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import { cleanupSessionFixtures, createSessionFixtures, closePrisma, type SessionFixtures } from "../helpers/session-fixtures";
import { sameOriginHeaders } from "../helpers/http";

/**
 * S-1 approval (owner, 2026-10-27, D37): the attendance_resolutions migration carries
 * the extra CHECK (STUDENT_ABSENT ⇒ no ledger row), test cleanup handles the new
 * append-only table, and a manual resolution serializes with report submission and
 * approval on the same session row. The resolution write path takes
 * `SELECT … FROM sessions … FOR UPDATE` first (S-1 write path); ATT-CC-01/02 hold
 * exactly that lock and prove the submit and approve paths wait for it.
 */

const getServerSessionMock = getServerSession as jest.Mock;
jest.setTimeout(180_000);

const MIGRATION = join(process.cwd(), "prisma/migrations/20261027120000_attendance_resolutions/migration.sql");
const HOLD_MS = 1_500;

let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function submitReport(sessionId: string, studentId: string) {
  asActor(fx.teacherUserId);
  const response = await submitReportRoute(
    apiRequest(`/api/sessions/${sessionId}/students/${studentId}/report`, {
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Covered the lesson content.",
      homework: "Practice page 12.",
      notes: "",
      extraTimeMinutes: 0,
    }),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function approveReport(reportId: string) {
  asActor(fx.adminUserId);
  const response = await reviewReportRoute(apiRequest(`/api/reports/${reportId}/review`, { action: "APPROVE" }), {
    params: Promise.resolve({ id: reportId }),
  });
  return { status: response.status, body: await response.json() };
}

async function createPastSession(studentId: string) {
  const end = new Date(Date.now() - 10 * 60 * 1000);
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
      students: { create: [{ studentId }] },
    },
    select: { id: true },
  });
}

/** Holds the resolution's session-row lock until `release()` is called. */
async function holdSessionLock(sessionId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      locked();
      await released;
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
  await isLocked;
  return { release, done };
}

async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<boolean> {
  const timer = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([promise.then(() => true), timer]);
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-1 approval — attendance_resolutions migration, cleanup, and lock order", () => {
  it("ATT-S1-01 (static): the migration is BOM-free and carries the owner's extra CHECK and the append-only trigger", () => {
    const sql = readFileSync(MIGRATION);
    expect(sql.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
    const text = sql.toString("utf8");
    expect(text).toMatch(/CHECK \("outcome" <> 'STUDENT_ABSENT' OR "subscription_ledger_id" IS NULL\)/);
    expect(text).toMatch(/CREATE TRIGGER attendance_resolutions_append_only BEFORE UPDATE OR DELETE ON "attendance_resolutions"/);
    expect(text).not.toMatch(/payroll_ledger"\s*\(/);
  });

  it("ATT-S1-02 (static): cleanup deletes attendance_resolutions through the trigger exception, gated, before subscription_ledger", () => {
    const helper = readFileSync(join(process.cwd(), "__tests__/helpers/session-fixtures.ts"), "utf8");
    const resolutions = helper.indexOf('deleteAppendOnly("attendance_resolutions", "attendance_resolutions_append_only"');
    const ledger = helper.indexOf('deleteAppendOnly("subscription_ledger"');
    expect(resolutions).toBeGreaterThan(-1);
    expect(resolutions).toBeLessThan(ledger);
    expect(helper).toMatch(/isAttendanceResolutionsReady\(\)/);
  });

  it("ATT-CC-01: a report submission waits while the session row is locked FOR UPDATE, then succeeds", async () => {
    const session = await createPastSession(fx.studentProfileIds.student1);
    const hold = await holdSessionLock(session.id);
    const submission = submitReport(session.id, fx.studentProfileIds.student1);
    expect(await settledWithin(submission, HOLD_MS)).toBe(false);
    hold.release();
    await hold.done;
    const result = await submission;
    expect(result.status).toBe(201);
  });

  it("ATT-CC-02: a report approval waits while the session row is locked FOR UPDATE, then succeeds", async () => {
    const session = await createPastSession(fx.studentProfileIds.student2);
    const submitted = await submitReport(session.id, fx.studentProfileIds.student2);
    expect(submitted.status).toBe(201);
    const hold = await holdSessionLock(session.id);
    const approval = approveReport(submitted.body.data.id);
    expect(await settledWithin(approval, HOLD_MS)).toBe(false);
    hold.release();
    await hold.done;
    const result = await approval;
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("APPROVED");
  });
});
