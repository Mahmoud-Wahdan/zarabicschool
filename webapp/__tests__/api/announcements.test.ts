jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));
// The 4 s + jitter spacing between announcement sends is real in the app; set to 0
// here only so a throttle test does not take minutes. The per-tick and per-hour caps
// stay the real values.
jest.mock("../../lib/config/announcements", () => ({
  ...jest.requireActual("../../lib/config/announcements"),
  ANNOUNCEMENT_SEND_SPACING_MS: 0,
  ANNOUNCEMENT_SEND_JITTER_MS: 0,
}));

import { getServerSession } from "next-auth";

import { POST as announceRoute } from "../../app/api/announcements/route";
import { PATCH as profilePatchRoute } from "../../app/api/admin/profiles/[id]/route";
import { computeAnnouncementRecipients, getActiveAnnouncements, getAnnouncementHistory } from "../../lib/announcements/service";
import { ANNOUNCEMENT_MAX_PER_BATCH, ANNOUNCEMENT_MAX_PER_DAY } from "../../lib/config/announcements";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import { fakeMessaging } from "../helpers/fake-messaging";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Announcements (backlog AN-04..12; owner rules 2026-10-26): Admin/Supervisor post;
 * recipients = active teachers/students/guardians, deduped by number, minus the
 * Admin-only "no announcements" flag; explicit count confirmation; append-only;
 * max 2 per rolling 24 h per academy; throttled delivery; nothing personal logged.
 * Per-run test academy only.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function request(pathName: string, method: string, body: unknown) {
  return new Request(`http://localhost:3000${pathName}`, {
    method,
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function announce(actorId: string, body: Record<string, unknown>) {
  asActor(actorId);
  const response = await announceRoute(request("/api/announcements", "POST", body));
  return { status: response.status, body: await response.json() };
}

async function confirmedCount() {
  return (await computeAnnouncementRecipients(fx.academyId)).whatsappRecipients;
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

beforeEach(() => {
  resetRateLimits();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Announcements", () => {
  it("AN-05/AN-10: recipients = active teachers/students/guardians, deduped by number; Admin/Supervisor, inactive, no-phone and opted-out users excluded", async () => {
    const base = await computeAnnouncementRecipients(fx.academyId);
    expect(base.recipientUserIds).not.toContain(fx.adminUserId);
    expect(base.recipientUserIds).not.toContain(fx.supervisorUserId);
    expect(base.recipientUserIds).toContain(fx.teacherUserId);

    // Shared number: student11 uses the guardian's number → one message.
    const guardian = await prisma.user.findUniqueOrThrow({ where: { id: fx.guardianUserId }, select: { phone: true } });
    await prisma.user.update({ where: { id: fx.studentUserIds.student11 }, data: { phone: guardian.phone } });
    // No phone, inactive, and opted out.
    await prisma.user.update({ where: { id: fx.studentUserIds.student10 }, data: { phone: null } });
    await prisma.user.update({ where: { id: fx.studentUserIds.student9 }, data: { isActive: false } });
    await prisma.user.update({ where: { id: fx.studentUserIds.student8 }, data: { announcementsOptOut: true } });

    const after = await computeAnnouncementRecipients(fx.academyId);
    expect(after.recipientUserIds.filter((id) => id === fx.guardianUserId || id === fx.studentUserIds.student11)).toHaveLength(1);
    expect(after.recipientUserIds).not.toContain(fx.studentUserIds.student10);
    expect(after.recipientUserIds).not.toContain(fx.studentUserIds.student9);
    expect(after.recipientUserIds).not.toContain(fx.studentUserIds.student8);
    expect(after.optedOut).toBe(1);
    expect(after.withoutPhone).toBe(1);
    expect(after.sharedNumbersMerged).toBe(1);
    expect(after.whatsappRecipients).toBe(base.whatsappRecipients - 4);
  });

  it("AN-12: only an ADMIN may set the 'no announcements' flag (Supervisor 403)", async () => {
    asActor(fx.supervisorUserId);
    const supervisor = await profilePatchRoute(request(`/api/admin/profiles/${fx.studentUserIds.student7}`, "PATCH", { announcementsOptOut: true }), { params: Promise.resolve({ id: fx.studentUserIds.student7 }) });
    expect(supervisor.status).toBe(403);
    asActor(fx.adminUserId);
    const admin = await profilePatchRoute(request(`/api/admin/profiles/${fx.studentUserIds.student7}`, "PATCH", { announcementsOptOut: true }), { params: Promise.resolve({ id: fx.studentUserIds.student7 }) });
    expect(admin.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.studentUserIds.student7 } })).announcementsOptOut).toBe(true);
    await prisma.user.update({ where: { id: fx.studentUserIds.student7 }, data: { announcementsOptOut: false } });
  });

  it("AN-04/AN-08/AN-09/AN-11: roles, stale count, expiry, daily limit, append-only, delivery throttle, redacted logs", async () => {
    // Roles: teachers, students and guardians cannot post.
    for (const actor of [fx.teacherUserId, fx.studentUserIds.student1, fx.guardianUserId]) {
      expect((await announce(actor, { title: "Hi", body: "Body", confirmRecipientCount: 1 })).status).toBe(403);
    }
    // Stale confirmation: nothing written.
    const stale = await announce(fx.adminUserId, { title: "Stale", body: "Stale body", confirmRecipientCount: 9999 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("RECIPIENTS_CHANGED");
    expect(stale.body.data.whatsappRecipients).toBe(await confirmedCount());
    // Expiry bounds.
    expect((await announce(fx.adminUserId, { title: "Old", body: "Old body", expiresAt: new Date(Date.now() - 1000).toISOString(), confirmRecipientCount: await confirmedCount() })).status).toBe(400);
    expect((await announce(fx.adminUserId, { title: "Far", body: "Far body", expiresAt: new Date(Date.now() + 91 * 24 * 3600 * 1000).toISOString(), confirmRecipientCount: await confirmedCount() })).status).toBe(400);
    expect(await prisma.announcement.count({ where: { academyId: fx.academyId } })).toBe(0);

    // Two sends (Supervisor + Admin) are allowed; the default expiry is 3 days.
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const secretBody = "سري — demo test body 0100 private";
    const first = await announce(fx.supervisorUserId, { title: "First", body: secretBody, confirmRecipientCount: await confirmedCount() });
    expect(first.status).toBe(201);
    const days = (new Date(first.body.data.expiresAt).getTime() - new Date(first.body.data.sentAt).getTime()) / (24 * 3600 * 1000);
    expect(Math.round(days)).toBe(3);
    const second = await announce(fx.adminUserId, { title: "Second", body: "Second body", confirmRecipientCount: await confirmedCount() });
    expect(second.status).toBe(201);
    // Third within 24 h → refused, nothing written.
    expect(ANNOUNCEMENT_MAX_PER_DAY).toBe(2);
    const third = await announce(fx.adminUserId, { title: "Third", body: "Third body", confirmRecipientCount: await confirmedCount() });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("ANNOUNCEMENT_DAILY_LIMIT");
    expect(await prisma.announcement.count({ where: { academyId: fx.academyId } })).toBe(2);

    // One job per recipient, ids-only payload.
    const jobs = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "ANNOUNCEMENT" }, select: { payload: true } });
    expect(jobs.length).toBe(2 * (await confirmedCount()));
    expect(jobs.every((job) => JSON.stringify(job.payload) === JSON.stringify({ announcementId: (job.payload as { announcementId: string }).announcementId }))).toBe(true);

    // Append-only: a sent announcement cannot be edited or deleted.
    await expect(prisma.announcement.update({ where: { id: first.body.data.id }, data: { title: "Edited" } })).rejects.toThrow();
    await expect(prisma.announcement.delete({ where: { id: first.body.data.id } })).rejects.toThrow();

    // Widget shows unexpired copies; history keeps everything.
    expect((await getActiveAnnouncements(fx.academyId)).map((row) => row.id)).toEqual(expect.arrayContaining([first.body.data.id, second.body.data.id]));
    expect((await getActiveAnnouncements(fx.academyId, new Date(Date.now() + 4 * 24 * 3600 * 1000))).length).toBe(0);
    expect((await getAnnouncementHistory(fx.academyId)).length).toBe(2);

    // Delivery throttle: one tick sends at most ANNOUNCEMENT_MAX_PER_BATCH.
    fakeMessaging.reset();
    await processDueNotificationJobs(new Date(), fx.academyId);
    const sent = await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ANNOUNCEMENT", status: "SENT" } });
    expect(sent).toBe(Math.min(ANNOUNCEMENT_MAX_PER_BATCH, jobs.length));
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ANNOUNCEMENT", status: "PENDING" } })).toBe(jobs.length - sent);

    // Logs: counts and ids only — never the text or a number.
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).not.toContain("سري");
    expect(logged).not.toContain("private");
    expect(logged).not.toMatch(/\+?20100000/);
    info.mockRestore();
  });
});
