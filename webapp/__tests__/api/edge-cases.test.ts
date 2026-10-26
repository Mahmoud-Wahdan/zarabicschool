jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { getServerSession } from "next-auth";

import { POST as fileComplaintRoute } from "../../app/api/complaints/route";
import { POST as applicationsRoute } from "../../app/api/applications/route";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { processDueNotificationJobs, recoverStaleProcessingJobs } from "../../lib/worker/notifications";
import { fakeMessaging } from "../helpers/fake-messaging";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
  writeInitialPurchase,
} from "../helpers/session-fixtures";

/**
 * Risk-ranked edge cases (Phase 8 coverage matrix, docs/specs/phase-08): group
 * settlement, worker retries, malformed ids on every [id] route, hostile input.
 * Per-run test academy only.
 */
jest.setTimeout(300_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
const MINUTE = 60 * 1000;

function asActor(userId: string | null) {
  getServerSessionMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function req(pathName: string, method: string, body?: unknown, raw?: string) {
  return new Request(`http://localhost:3000${pathName}`, {
    method,
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: method === "GET" || method === "HEAD" ? undefined : raw ?? JSON.stringify(body ?? {}),
  });
}

async function fundedReservation(sessionId: string, studentId: string) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId, studentId, packageType: "MONTHLY_PLAN", sessionsPurchased: 4, totalAmountMinor: BigInt(100000), currency: "EGP", status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - 5 * 24 * 3600 * 1000), periodEndsAt: new Date(Date.now() + 25 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  await writeInitialPurchase({ academyId: fx.academyId, subscriptionId: subscription.id, sessionsDelta: 4 });
  await prisma.sessionReservation.create({ data: { academyId: fx.academyId, sessionId, studentId, subscriptionId: subscription.id } });
  return subscription.id;
}

async function groupSession(studentKeys: string[]) {
  const end = new Date(Date.now() - 15 * MINUTE);
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "GROUP",
      scheduledStart: new Date(end.getTime() - 60 * MINUTE), scheduledEnd: end, durationMinutes: 60, timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "SCHEDULED",
      students: { create: studentKeys.map((key) => ({ studentId: fx.studentProfileIds[key] })) },
    },
    select: { id: true },
  });
  for (const key of studentKeys) await fundedReservation(session.id, fx.studentProfileIds[key]);
  return session.id;
}

async function submit(sessionId: string, studentKey: string, outcome: "ATTENDED" | "STUDENT_ABSENT") {
  const studentId = fx.studentProfileIds[studentKey];
  asActor(fx.teacherUserId);
  const response = await submitReportRoute(
    req(`/api/sessions/${sessionId}/students/${studentId}/report`, "POST", { attendanceOutcome: outcome, classRemark: "good", summary: "Group lesson.", homework: "Page 4.", notes: "" }),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  expect(response.status).toBe(201);
  return (await response.json()).data.id as string;
}

async function approve(reportId: string) {
  asActor(fx.adminUserId);
  return reviewReportRoute(req(`/api/reports/${reportId}/review`, "POST", { action: "APPROVE" }), { params: Promise.resolve({ id: reportId }) });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

beforeEach(() => {
  resetRateLimits();
  fakeMessaging.reset();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Worker delivery retries (run first: no other due jobs in the academy)", () => {
  async function dueJob(kind = "SESSION_REQUEST") {
    return prisma.notificationJob.create({
      data: { academyId: fx.academyId, sessionId: null, recipientUserId: fx.adminUserId, kind, dedupKey: `demo_test_retry_${Math.random()}`, scheduledFor: new Date(Date.now() - MINUTE), status: "PENDING" },
      select: { id: true },
    });
  }
  const row = (id: string) => prisma.notificationJob.findUniqueOrThrow({ where: { id }, select: { status: true, attempts: true, scheduledFor: true, lastError: true } });

  it("RTY-01: a transient failure is retried after 2 min, then 10 min, and becomes FAILED after 3 attempts", async () => {
    const job = await dueJob();
    fakeMessaging.failNext("Provider busy.", true);
    await processDueNotificationJobs(new Date(), fx.academyId);
    let current = await row(job.id);
    expect(current).toMatchObject({ status: "PENDING", attempts: 1, lastError: "Provider busy." });
    expect(current.scheduledFor.getTime() - Date.now()).toBeGreaterThan(1.5 * MINUTE);
    fakeMessaging.failNext("Provider busy.", true);
    await processDueNotificationJobs(new Date(Date.now() + 3 * MINUTE), fx.academyId);
    current = await row(job.id);
    expect(current).toMatchObject({ status: "PENDING", attempts: 2 });
    expect(current.scheduledFor.getTime() - Date.now()).toBeGreaterThan(8 * MINUTE);
    fakeMessaging.failNext("Provider busy.", true);
    await processDueNotificationJobs(new Date(Date.now() + 15 * MINUTE), fx.academyId);
    expect(await row(job.id)).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("RTY-02: a permanent failure is FAILED at once (no retry)", async () => {
    const job = await dueJob();
    fakeMessaging.failNext("Recipient blocked.", false);
    await processDueNotificationJobs(new Date(), fx.academyId);
    expect(await row(job.id)).toMatchObject({ status: "FAILED", attempts: 1, lastError: "Recipient blocked." });
  });

  it("RTY-03: a job stuck in PROCESSING (crashed send) becomes FAILED and is NEVER re-sent automatically", async () => {
    const job = await dueJob();
    await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });
    await prisma.$executeRaw`UPDATE notification_jobs SET updated_at = now() - interval '11 minutes' WHERE id = ${job.id}::uuid`;
    await recoverStaleProcessingJobs(new Date(), fx.academyId);
    expect((await row(job.id)).status).toBe("FAILED");
    await processDueNotificationJobs(new Date(), fx.academyId);
    expect(fakeMessaging.sent).toHaveLength(0);
  });
});

describe("Group sessions — the teacher is credited ONCE per session", () => {
  const ledger = async (sessionId: string) => ({
    credits: await prisma.payrollLedger.count({ where: { sessionId, entryType: "SESSION_CREDIT" } }),
    deductions: await prisma.subscriptionLedger.count({ where: { sessionId, entryType: "SESSION_DEDUCTION" } }),
  });

  it("GRP-01: two attended students approved one after the other → 2 deductions, 1 teacher credit", async () => {
    const sessionId = await groupSession(["student1", "student2"]);
    const a = await submit(sessionId, "student1", "ATTENDED");
    const b = await submit(sessionId, "student2", "ATTENDED");
    expect((await approve(a)).status).toBe(200);
    expect((await approve(b)).status).toBe(200);
    expect(await ledger(sessionId)).toEqual({ credits: 1, deductions: 2 });
  });

  it("GRP-02: the same with CONCURRENT approvals → still 2 deductions and 1 credit, no error", async () => {
    const sessionId = await groupSession(["student3", "student4"]);
    const a = await submit(sessionId, "student3", "ATTENDED");
    const b = await submit(sessionId, "student4", "ATTENDED");
    const results = await Promise.all([approve(a), approve(b)]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(await ledger(sessionId)).toEqual({ credits: 1, deductions: 2 });
  });

  it("GRP-03: one attended + one absent → 1 deduction, 1 credit, the absent student's reservation released", async () => {
    const sessionId = await groupSession(["student5", "student6"]);
    await approve(await submit(sessionId, "student5", "ATTENDED"));
    await approve(await submit(sessionId, "student6", "STUDENT_ABSENT"));
    expect(await ledger(sessionId)).toEqual({ credits: 1, deductions: 1 });
    const absent = await prisma.sessionReservation.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId: fx.studentProfileIds.student6 } } });
    expect(absent.status).toBe("RELEASED");
  });
});

describe("Malformed and hostile ids on every [id] route never cause a server error", () => {
  const API_ROOT = path.join(process.cwd(), "app", "api");
  const EXEMPT = [path.join("auth", "[...nextauth]", "route.ts")];
  const routes = (function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return entry === "route.ts" && full.includes("[") ? [full] : [];
    });
  })(API_ROOT).filter((file) => !EXEMPT.includes(path.relative(API_ROOT, file)));

  it("VAL-01: every handler answers < 500 for 'not-a-uuid', an injection string and an over-long id (as Admin)", async () => {
    expect(routes.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(file) as Record<string, (request: Request, context: unknown) => Promise<Response>>;
      for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        if (!new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source)) continue;
        for (const id of ["not-a-uuid", "1' OR '1'='1", "x".repeat(5000)]) {
          asActor(fx.adminUserId);
          const context = { params: Promise.resolve(new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : id) })) };
          try {
            const response = await mod[method](req(`/api/x/${encodeURIComponent(id).slice(0, 50)}`, method, {}), context);
            if (response.status >= 500) failures.push(`${method} ${path.relative(API_ROOT, file)} [${id.slice(0, 12)}] → ${response.status}`);
          } catch (cause) {
            failures.push(`${method} ${path.relative(API_ROOT, file)} [${id.slice(0, 12)}] → threw ${cause instanceof Error ? cause.message.split("\n")[0].slice(0, 80) : "error"}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("Hostile and huge input", () => {
  it("VAL-02: an injection-looking complaint title and Arabic/RTL body are stored literally (parameterized queries)", async () => {
    const end = new Date(Date.now() - 30 * MINUTE);
    const s = await prisma.session.create({
      data: {
        academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
        scheduledStart: new Date(end.getTime() - 60 * MINUTE), scheduledEnd: end, durationMinutes: 60, timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "COMPLETED",
        students: { create: [{ studentId: fx.studentProfileIds.student9 }] },
      },
      select: { id: true },
    });
    const title = "'; DROP TABLE complaints; -- <img src=x onerror=alert(1)>";
    const body = "‏المعلم تأخر ‎— مرحباً‮عكس‬ ✓";
    asActor(fx.studentUserIds.student9);
    const response = await fileComplaintRoute(req("/api/complaints", "POST", { sessionId: s.id, concernedUserId: fx.teacherUserId, category: "OTHER", title, body }));
    expect(response.status).toBe(201);
    const row = await prisma.complaint.findFirstOrThrow({ where: { sessionId: s.id } });
    expect(row.title).toBe(title);
    expect(row.body).toBe(body);
    expect(await prisma.complaint.count()).toBeGreaterThan(0);
  });

  it("VAL-03: the public application form refuses empty, malformed, oversized and huge-field input with 4xx, never 500", async () => {
    asActor(null);
    const post = (raw: string, ip: string) => applicationsRoute(new Request("http://localhost:3000/api/applications", {
      method: "POST", headers: sameOriginHeaders({ "content-type": "application/json", "x-forwarded-for": ip }), body: raw,
    }));
    for (const [raw, ip] of [
      ["", "198.51.100.10"],
      ["{not json", "198.51.100.11"],
      [JSON.stringify({ type: "STUDENT", full_name: "x".repeat(100_000), phone_whatsapp: "0100", subjects: [] }), "198.51.100.12"],
      [JSON.stringify({ type: "STUDENT", full_name: "", phone_whatsapp: "", subjects: ["a".repeat(5000)] }), "198.51.100.13"],
      ["x".repeat(2 * 1024 * 1024), "198.51.100.14"],
    ] as const) {
      const response = await post(raw, ip);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
  });
});
