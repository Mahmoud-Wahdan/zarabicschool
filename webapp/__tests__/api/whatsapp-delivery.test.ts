jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { createHmac, randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as statusWebhook } from "../../app/api/whatsapp/status/route";
import { POST as adminMessageRoute } from "../../app/api/admin/messages/route";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * WhatsApp delivery webhook (signed by OpenWA) and Admin individual messages
 * (backlog WA-*). Test-only secret/session values are set in the process env and
 * restored afterwards; never read from .env, never printed. Per-run test academy.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
const SECRET = `demo_test_wa_${Math.random().toString(36).slice(2)}`;
const SESSION = "demo_test_session";
let fx: SessionFixtures;
const saved = { secret: process.env.OPENWA_WEBHOOK_SECRET, session: process.env.OPENWA_SESSION_ID };

function signed(body: unknown, options: { signature?: string | null } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const signature = options.signature === undefined ? `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}` : options.signature;
  return statusWebhook(new Request("http://localhost:3000/api/whatsapp/status", {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-openwa-signature": signature } : {}) },
    body: raw,
  }));
}

async function sentJob(messageId: string) {
  return prisma.notificationJob.create({
    data: {
      academyId: fx.academyId, sessionId: null, recipientUserId: fx.teacherUserId, kind: "ADMIN_MESSAGE",
      dedupKey: `demo_test_wa_${randomUUID()}`, scheduledFor: new Date(), status: "SENT", providerMessageId: messageId,
    },
    select: { id: true },
  });
}

const delivery = async (id: string) => (await prisma.notificationJob.findUniqueOrThrow({ where: { id }, select: { deliveryStatus: true } })).deliveryStatus;

async function sendAdminMessage(actorId: string, body: Record<string, unknown>) {
  getServerSessionMock.mockResolvedValue({ user: { id: actorId } });
  const response = await adminMessageRoute(new Request("http://localhost:3000/api/admin/messages", {
    method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  process.env.OPENWA_WEBHOOK_SECRET = SECRET;
  process.env.OPENWA_SESSION_ID = SESSION;
  fx = await createSessionFixtures();
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  if (saved.secret === undefined) delete process.env.OPENWA_WEBHOOK_SECRET; else process.env.OPENWA_WEBHOOK_SECRET = saved.secret;
  if (saved.session === undefined) delete process.env.OPENWA_SESSION_ID; else process.env.OPENWA_SESSION_ID = saved.session;
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("WhatsApp delivery webhook", () => {
  it("WA-01: missing/wrong signature → 401 and nothing changes; oversized → 413; signed non-JSON → 400", async () => {
    const messageId = `demo_test_msg_${randomUUID()}`;
    const job = await sentJob(messageId);
    const body = { event: "message.ack", sessionId: SESSION, data: { messageId, status: "delivered" } };
    expect((await signed(body, { signature: null })).status).toBe(401);
    expect((await signed(body, { signature: "sha256=deadbeef" })).status).toBe(401);
    expect(await delivery(job.id)).toBeNull();
    expect((await signed("x".repeat(70 * 1024))).status).toBe(413);
    expect((await signed("{not json")).status).toBe(400);
  });

  it("WA-02: delivery status only moves forward — SENT→DELIVERED→READ; replays and FAILED never downgrade", async () => {
    const messageId = `demo_test_msg_${randomUUID()}`;
    const job = await sentJob(messageId);
    const ack = (status: string) => signed({ event: "message.ack", sessionId: SESSION, data: { messageId, status } });
    expect((await ack("delivered")).status).toBe(200);
    expect(await delivery(job.id)).toBe("DELIVERED");
    await ack("sent");
    expect(await delivery(job.id)).toBe("DELIVERED");
    await ack("read");
    expect(await delivery(job.id)).toBe("READ");
    await signed({ event: "message.failed", sessionId: SESSION, data: { messageId } });
    expect(await delivery(job.id)).toBe("READ");
  });

  it("WA-03: a signed event for another OpenWA session or an unknown event is acknowledged and ignored", async () => {
    const messageId = `demo_test_msg_${randomUUID()}`;
    const job = await sentJob(messageId);
    const other = await signed({ event: "message.ack", sessionId: "someone-else", data: { messageId, status: "read" } });
    expect(await other.json()).toEqual({ ok: true, ignored: true });
    await signed({ event: "message.revoked", sessionId: SESSION, data: { messageId } });
    expect(await delivery(job.id)).toBeNull();
  });
});

describe("Admin individual messages", () => {
  it("AM-01: an Admin message stores the body only in admin_messages; the job carries ids only; the worker delivers it", async () => {
    const body = "رسالة خاصة — demo test private text";
    const result = await sendAdminMessage(fx.adminUserId, { recipientUserId: fx.teacherUserId, body });
    expect(result.status).toBe(201);
    expect(JSON.stringify(result.body)).not.toContain("private text");
    const job = await prisma.notificationJob.findUniqueOrThrow({ where: { id: result.body.data.jobId } });
    expect(job.payload).toEqual({ adminMessageId: result.body.data.messageId });
    expect((await prisma.adminMessage.findUniqueOrThrow({ where: { id: result.body.data.messageId } })).body).toBe(body);
    await processDueNotificationJobs(new Date(), fx.academyId);
    expect((await prisma.notificationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SENT");
  });

  it("AM-02: Supervisor 403; another academy's user 404; a user without a phone 409; empty or 4001-char body 400", async () => {
    expect((await sendAdminMessage(fx.supervisorUserId, { recipientUserId: fx.teacherUserId, body: "x" })).status).toBe(403);
    expect((await sendAdminMessage(fx.adminUserId, { recipientUserId: fx.foreignTeacherUserId, body: "x" })).status).toBe(404);
    await prisma.user.update({ where: { id: fx.studentUserIds.student12 }, data: { phone: null } });
    const noPhone = await sendAdminMessage(fx.adminUserId, { recipientUserId: fx.studentUserIds.student12, body: "x" });
    expect(noPhone.status).toBe(409);
    expect(noPhone.body.error.code).toBe("RECIPIENT_NO_PHONE");
    expect((await sendAdminMessage(fx.adminUserId, { recipientUserId: fx.teacherUserId, body: "   " })).status).toBe(400);
    expect((await sendAdminMessage(fx.adminUserId, { recipientUserId: fx.teacherUserId, body: "x".repeat(4001) })).status).toBe(400);
  });
});
