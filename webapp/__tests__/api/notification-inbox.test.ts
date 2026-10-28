jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as inboxRoute } from "../../app/api/notifications/route";
import { POST as readRoute } from "../../app/api/notifications/read/route";
import { GET as badgeRoute } from "../../app/api/notifications/badge/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-06 notification inbox (D12, SQL S-4). Everyone sees their own notification jobs
 * (read state = notification_jobs.read_at); staff (Admin/Supervisor) also see team
 * queue items with per-user read state (notification_reads). Complaints are staff
 * only; money items (payment anomalies, renewals) never reach the Supervisor;
 * credentials and evaluation kinds never appear. Per-run test academy.
 */
jest.setTimeout(240_000);

type Item = { key: string; kind: string; href: string; read: boolean; createdAt: string };
const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
let endedSessionId: string;
let complaintId: string;
let requestId: string;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const inbox = async (): Promise<Item[]> => (await (await inboxRoute()).json()).data.items;
const markRead = (body: unknown, headers = sameOriginHeaders({ "content-type": "application/json" })) =>
  readRoute(new Request("http://localhost:3000/api/notifications/read", { method: "POST", headers, body: JSON.stringify(body) }));
const job = (recipientUserId: string, kind: string, extra: Record<string, unknown> = {}) =>
  prisma.notificationJob.create({
    data: { academyId: fx.academyId, recipientUserId, kind, dedupKey: `test:${kind}:${recipientUserId}:${Math.random()}`, scheduledFor: new Date(), status: "SENT", ...extra },
  });

beforeAll(async () => {
  fx = await createSessionFixtures();
  const start = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + 45 * 60 * 1000), durationMinutes: 45, timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "SCHEDULED",
      students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
    },
  });
  endedSessionId = session.id;
  complaintId = (await prisma.complaint.create({
    data: { academyId: fx.academyId, sessionId: session.id, filedById: fx.guardianUserId, filedByRole: "GUARDIAN", category: "TECHNICAL", title: "demo_test complaint", body: "demo_test complaint body" },
  })).id;
  requestId = (await prisma.sessionRequest.create({ data: { academyId: fx.academyId, sessionId: session.id, requestedById: fx.teacherUserId, reason: "demo_test outage" } })).id;
  await job(fx.guardianUserId, "REPORT_SUBMITTED");
  await job(fx.guardianUserId, "RENEWAL_PAID");
  await job(fx.guardianUserId, "CREDENTIALS");
  await job(fx.guardianUserId, "EVALUATION_REMINDER");
  await job(fx.studentUserIds.student2, "REPORT_SUBMITTED");
  await job(fx.adminUserId, "PAYMENT_ANOMALY", { payload: { reason: "AMOUNT_MISMATCH" } });
  await job(fx.supervisorUserId, "SESSION_REQUEST");
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-06 notification inbox", () => {
  it("NT-01: a guardian sees only their own jobs (not credentials or evaluation kinds), unread, with a link", async () => {
    as(fx.guardianUserId);
    const items = await inbox();
    expect(items.map((item) => item.kind).sort()).toEqual(["RENEWAL_PAID", "REPORT_SUBMITTED"]);
    expect(items.every((item) => item.read === false && item.key.startsWith("JOB:") && item.href.startsWith("/"))).toBe(true);
    expect(items.find((item) => item.kind === "RENEWAL_PAID")?.href).toBe("/guardian/invoices");
    expect(JSON.stringify(items)).not.toMatch(/demo_test|\+20|password/i);
  });

  it("NT-02: staff see the team queues (missing report, outage request, complaint) plus their own jobs; a teacher never sees complaints", async () => {
    for (const userId of [fx.adminUserId, fx.supervisorUserId]) {
      as(userId);
      const keys = (await inbox()).map((item) => item.key);
      expect(keys).toEqual(expect.arrayContaining([
        `MISSING_REPORT:${endedSessionId}:${fx.studentProfileIds.student1}`,
        `SESSION_REQUEST:${requestId}`,
        `COMPLAINT:${complaintId}`,
      ]));
    }
    as(fx.teacherUserId);
    expect((await inbox()).some((item) => item.kind.startsWith("COMPLAINT"))).toBe(false);
  });

  it("NT-03: money items reach the Admin only, never the Supervisor", async () => {
    as(fx.adminUserId);
    expect((await inbox()).some((item) => item.kind === "PAYMENT_ANOMALY")).toBe(true);
    as(fx.supervisorUserId);
    const kinds = (await inbox()).map((item) => item.kind);
    expect(kinds.some((kind) => /PAYMENT|RENEWAL|INVOICE|PAYROLL|BALANCE/.test(kind))).toBe(false);
  });

  it("NT-04: read state is per user — the Admin reading a team item leaves it unread for the Supervisor; own jobs are marked through read_at", async () => {
    as(fx.adminUserId);
    const key = `COMPLAINT:${complaintId}`;
    expect((await markRead({ keys: [key] })).status).toBe(200);
    expect((await inbox()).find((item) => item.key === key)?.read).toBe(true);
    as(fx.supervisorUserId);
    expect((await inbox()).find((item) => item.key === key)?.read).toBe(false);
    as(fx.guardianUserId);
    const own = (await inbox()).find((item) => item.kind === "REPORT_SUBMITTED")!;
    await markRead({ keys: [own.key] });
    expect((await inbox()).find((item) => item.key === own.key)?.read).toBe(true);
  });

  it("NT-05: nobody marks someone else's job; keys are validated; mark-all works; cross-origin 403; signed-out 401", async () => {
    const other = await prisma.notificationJob.findFirstOrThrow({ where: { recipientUserId: fx.studentUserIds.student2 } });
    as(fx.guardianUserId);
    await markRead({ keys: [`JOB:${other.id}`] });
    expect((await prisma.notificationJob.findUniqueOrThrow({ where: { id: other.id } })).readAt).toBeNull();
    expect((await markRead({ keys: ["DROP TABLE x"] })).status).toBe(400);
    expect((await markRead({ keys: Array.from({ length: 201 }, (_, i) => `COMPLAINT:${i}`) })).status).toBe(400);
    expect((await markRead({ all: true })).status).toBe(200);
    expect((await inbox()).every((item) => item.read)).toBe(true);
    expect((await markRead({ all: true }, { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" })).status).toBe(403);
    getServerSessionMock.mockResolvedValue(null);
    expect((await markRead({ all: true })).status).toBe(401);
  });

  it("NT-06: the bell counts the viewer's unread inbox items", async () => {
    as(fx.supervisorUserId);
    const unread = (await inbox()).filter((item) => !item.read).length;
    expect(unread).toBeGreaterThan(0);
    // A5: the route answers ONE number for the caller only: no names, titles or queue details.
    expect((await (await badgeRoute()).json()).data).toEqual({ count: unread });
    getServerSessionMock.mockResolvedValue(null);
    expect((await badgeRoute()).status).toBe(401);
  });
});
