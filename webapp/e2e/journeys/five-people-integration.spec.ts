import { randomUUID } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { call, expect, expectHealthyPage, messages, test, visit } from "../support/test";

/**
 * One story across the five people of the academy, each on their own screen:
 *   1. the Admin sends an announcement → the Supervisor, teacher, guardian and student read it;
 *   2. the Admin books a session (teacher + student1) → it appears in the teacher's, the
 *      student's and the guardian's calendars, and on the Supervisor's session list;
 *   3. the student reports an outage on it → the Supervisor and the Admin see the request;
 *      the Supervisor rejects it;
 *   4. the guardian files a complaint about it through the form → the Supervisor resolves it
 *      and the Admin sees it resolved;
 *   5. the Admin cancels the session → the student's calendar shows it cancelled and the
 *      credit returns.
 * The report → approval → pay chain across the same people is report-lifecycle.spec.ts.
 */
test.describe.configure({ mode: "serial" });

const tag = randomUUID().slice(0, 6);
const story: { sessionId?: string; start?: Date; weekOf?: string; requestId?: string; complaintTitle?: string } = {};

const cairoYmd = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** "16:35" or "4:35": the booked start as either clock shows it. */
function startClock(date: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(date));
  const minute = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", minute: "2-digit" }).format(date).padStart(2, "0");
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return new RegExp(`(?:^|\\D)(?:${String(hour).padStart(2, "0")}|${hour}|${twelve}):${minute}(?:\\D|$)`);
}

test("1. the Admin's announcement reaches the Supervisor, the teacher, the guardian and the student", async ({ api, open }) => {
  const admin = await api("admin");
  const recipients = await (await call(() => admin.get("/api/announcements/recipients"))).json();
  const title = `Eid holiday ${tag}`;
  const sent = await admin.post("/api/announcements", {
    data: { title, body: "No sessions on the first day of Eid.", confirmRecipientCount: recipients.data.whatsappRecipients },
  });
  expect(sent.status(), await sent.text()).toBe(201);

  for (const [who, path] of [["supervisor", "/admin/announcements"], ["teacher", "/announcements"], ["guardian", "/announcements"], ["student", "/announcements"]] as const) {
    const page = await open(who, { locale: "ar" });
    await visit(page, `/ar${path}`);
    await expectHealthyPage(page, "ar", `${who} ${path}`);
    await expect(page.getByText(title).first(), who).toBeVisible();
  }
});

test("2. a session the Admin books shows in the teacher's, the student's and the guardian's calendars", async ({ api, open }) => {
  const r = run();
  const admin = await api("admin");
  // Inside the fixture's 30-day credit period; minute 35 keeps it apart from other bookings.
  for (let attempt = 0; attempt < 5 && !story.sessionId; attempt++) {
    const day = new Date(Date.now() + (3 + Math.floor(Math.random() * 10)) * 86_400_000);
    const start = new Date(`${cairoYmd(day)}T${String(7 + Math.floor(Math.random() * 12)).padStart(2, "0")}:35:00+02:00`);
    const booked = await admin.post("/api/sessions", {
      data: {
        teacherId: r.fixtures.teacherProfileId,
        subjectId: r.fixtures.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: start.toISOString(),
        scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(),
        timezone: "Africa/Cairo",
        zoomJoinUrl: `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`,
        studentIds: [r.fixtures.studentProfileIds.student1],
      },
    });
    if (booked.status() === 409) continue; // the teacher is busy then: pick another slot
    expect(booked.status(), await booked.text()).toBe(201);
    story.sessionId = (await booked.json()).data.id;
    story.start = start;
    story.weekOf = cairoYmd(start);
  }
  expect(story.sessionId, "booked").toBeDefined();
  const clock = startClock(story.start!);

  for (const who of ["teacher", "student", "guardian"] as const) {
    const page = await open(who, { locale: "en" });
    await visit(page, `/en/${who}/calendar?week=${story.weekOf}`);
    await expectHealthyPage(page, "en", `${who} calendar`);
    await expect(page.locator("li").filter({ hasText: clock }).first(), `${who} sees the booking`).toBeVisible();
  }

  const supervisor = await api("supervisor");
  const listed = (await (await call(() => supervisor.get("/api/sessions"))).json()).data as { id: string }[];
  expect(listed.some((session) => session.id === story.sessionId), "the Supervisor's session list").toBe(true);
});

test("3. the student reports an outage; the Supervisor and the Admin see it; the Supervisor rejects it", async ({ api, open }) => {
  const reason = `My internet is down ${tag}`;
  const student = await api("student");
  const filed = await student.post(`/api/sessions/${story.sessionId}/session-request`, { data: { reason } });
  expect(filed.status(), await filed.text()).toBe(201);
  story.requestId = (await filed.json()).data.id;

  for (const [who, path] of [["supervisor", "/supervisor/session-requests"], ["admin", "/admin/session-requests"]] as const) {
    const page = await open(who, { locale: "en" });
    await visit(page, `/en${path}`);
    await expectHealthyPage(page, "en", `${who} ${path}`);
    // The table lists it under the session's time; opening the row shows the reason.
    const row = page.locator("table tr").filter({ hasText: startClock(story.start!) }).filter({ hasText: messages.en.sessionRequests.statuses.PENDING });
    await row.first().getByRole("button").first().click();
    await expect(page.getByText(reason), `${who} reads the reason`).toBeVisible();
  }
  const [pending] = await query<{ status: string }>("SELECT status::text FROM session_requests WHERE id = $1", [story.requestId]);
  expect(pending.status).toBe("PENDING");

  const supervisor = await api("supervisor");
  const reviewed = await supervisor.post(`/api/session-requests/${story.requestId}/review`, { data: { action: "REJECT" } });
  expect(reviewed.status(), await reviewed.text()).toBe(200);
  const [stored] = await query<{ status: string }>("SELECT status::text FROM session_requests WHERE id = $1", [story.requestId]);
  expect(stored.status).toBe("REJECTED");
});

test("4. the guardian complains about the session through the form; the Supervisor resolves it; the Admin sees it resolved", async ({ open }) => {
  const r = run();
  const form = messages.en.complaintForm;
  story.complaintTitle = `Teacher was late ${tag}`;
  const guardian = await open("guardian", { locale: "en" });
  await visit(guardian, "/en/complaints/new");
  await expectHealthyPage(guardian, "en", "guardian complaint form");
  await guardian.getByLabel(form.sessionLabel).selectOption(story.sessionId!);
  const concerned = guardian.getByLabel(form.concernedLabel);
  await expect(concerned.locator(`option[value="${r.fixtures.teacherUserId}"]`)).toHaveCount(1);
  await concerned.selectOption(r.fixtures.teacherUserId);
  await guardian.getByLabel(form.categoryLabel).selectOption("PUNCTUALITY");
  await guardian.getByLabel(form.titleLabel).fill(story.complaintTitle);
  await guardian.getByLabel(form.bodyLabel).fill("The teacher joined fifteen minutes late.");
  await guardian.getByRole("button", { name: form.submit }).click();
  await expect(guardian.getByText(form.sentTitle)).toBeVisible();

  const [complaint] = await query<{ id: string; filed_by_role: string }>(
    "SELECT id, filed_by_role::text FROM complaints WHERE academy_id = $1 AND title = $2",
    [r.fixtures.academyId, story.complaintTitle],
  );
  expect(complaint.filed_by_role).toBe("GUARDIAN");

  const t = messages.en.complaintsAdmin;
  const supervisor = await open("supervisor", { locale: "en" });
  await visit(supervisor, "/en/admin/complaints");
  await supervisor.getByText(story.complaintTitle).first().click();
  await supervisor.waitForURL(`**/en/admin/complaints/${complaint.id}`);
  await expectHealthyPage(supervisor, "en", "supervisor complaint");
  await supervisor.getByRole("button", { name: t.startAction }).click();
  await expect(supervisor.getByText(t.status.IN_PROGRESS).first()).toBeVisible();
  await supervisor.getByLabel(t.resolutionNoteLabel).fill("Talked to the teacher; it will not happen again.");
  await supervisor.getByRole("button", { name: t.resolveAction }).click();
  await expect(supervisor.getByText(t.status.RESOLVED).first()).toBeVisible();

  const admin = await open("admin", { locale: "en" });
  await visit(admin, `/en/admin/complaints/${complaint.id}`);
  await expectHealthyPage(admin, "en", "admin complaint");
  await expect(admin.getByText(t.status.RESOLVED).first()).toBeVisible();
});

test("5. the Admin cancels the session: the student's calendar shows it cancelled and the credit returns", async ({ api, open }) => {
  const admin = await api("admin");
  const [before] = await query<{ status: string }>("SELECT status::text FROM session_reservations WHERE session_id = $1", [story.sessionId]);
  expect(before.status).toBe("RESERVED");
  const cancelled = await admin.patch(`/api/sessions/${story.sessionId}`, { data: { status: "CANCELLED", cancellationReason: `e2e story ${tag}` } });
  expect(cancelled.ok(), await cancelled.text()).toBe(true);
  const [after] = await query<{ status: string }>("SELECT status::text FROM session_reservations WHERE session_id = $1", [story.sessionId]);
  expect(after.status).not.toBe("RESERVED");

  const page = await open("student", { locale: "en" });
  await visit(page, `/en/student/calendar?week=${story.weekOf}`);
  const entry = page.locator("li").filter({ hasText: startClock(story.start!) }).first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(messages.en.sessionsAdmin.statuses.CANCELLED);
});
