import { query } from "../support/db";
import { run } from "../support/run";
import { expect, messages, test, visit } from "../support/test";

/**
 * Scheduling and live-link journeys (Phases 3-4; the scenarios of the former
 * e2e/phase3.e2e.spec.ts, rebuilt on the per-run academy): the Admin books through the
 * smart form, the booking rules answer with their codes, join links redirect only to the
 * stored Zoom link and log the click, cancelling is idempotent and frees the credit.
 */
test.describe.configure({ mode: "serial" });

const t = messages.en.sessionsAdmin;
const zoom = () => `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`;
const created: { id?: string; start?: Date; end?: Date } = {};

/** A Cairo wall-clock slot N days ahead (Cairo has no DST from November to April). */
function cairoSlot(days: number, hour: number) {
  const day = new Date(Date.now() + days * 86_400_000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
  const pad = (value: number) => String(value).padStart(2, "0");
  return { start: `${ymd}T${pad(hour)}:00`, end: `${ymd}T${pad(hour + 1)}:00` };
}

function booking(overrides: Record<string, unknown> = {}) {
  const r = run();
  // Inside the fixture's 30-day credit period, away from the UI booking (16-27 days).
  const start = new Date(Date.now() + 12 * 86_400_000);
  return {
    teacherId: r.fixtures.teacherProfileId,
    subjectId: r.fixtures.subjectId,
    sessionType: "PRIVATE",
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(),
    timezone: "Africa/Cairo",
    zoomJoinUrl: zoom(),
    studentIds: [r.fixtures.studentProfileIds.student4],
    ...overrides,
  };
}

test("the Admin books a private session through the smart form", async ({ open, api }) => {
  const r = run();
  const link = zoom();
  // A random slot inside the fixture's 30-day credit period (16-27 days ahead), so a
  // re-run never collides with an earlier run's booking.
  const slot = cairoSlot(16 + Math.floor(Math.random() * 12), 8 + Math.floor(Math.random() * 10));
  const page = await open("admin");
  await visit(page, "/en/admin/sessions");
  await expect(page.getByRole("heading", { name: t.page.title })).toBeVisible();
  const form = page.locator("details", { hasText: t.single.title });
  await form.locator("summary").click();
  await form.getByLabel(t.labels.teacher).selectOption({ label: "Demo Test teacher" });
  const subject = form.getByLabel(t.labels.subject);
  await expect(subject.locator(`option[value="${r.fixtures.subjectId}"]`)).toHaveCount(1);
  await subject.selectOption(r.fixtures.subjectId);
  await form.getByLabel(t.labels.sessionType).selectOption("PRIVATE");
  await form.getByLabel(new RegExp(`^${t.labels.starts}`)).fill(slot.start);
  await form.getByLabel(new RegExp(`^${t.labels.ends}`)).fill(slot.end);
  await form.getByLabel(t.labels.zoomJoin).fill(link);
  await form.getByRole("button", { name: "Demo Test student4" }).click();
  await form.getByRole("button", { name: t.single.create }).click();

  // The session list carries no Zoom link (B5), so the new row is found by its link in the DB.
  const findCreated = async () =>
    query<{ id: string; status: string; scheduled_start: Date; scheduled_end: Date }>("SELECT id, status, scheduled_start, scheduled_end FROM sessions WHERE zoom_join_url = $1", [link]);
  await expect.poll(async () => (await findCreated()).length).toBe(1);
  const [row] = await findCreated();
  const session = { id: row.id, status: row.status, scheduledStart: new Date(row.scheduled_start).toISOString(), scheduledEnd: new Date(row.scheduled_end).toISOString() };
  const admin = await api("admin");
  const listed = ((await (await admin.get("/api/sessions")).json()).data as { id: string }[]).find((s) => s.id === session.id);
  expect(listed).toBeDefined();
  expect(JSON.stringify(listed)).not.toContain("zoom.us");
  expect(session.status).toBe("SCHEDULED");
  // The typed time is Cairo wall clock (the viewer's zone), stored as the right instant.
  expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(new Date(session.scheduledStart))).toBe(slot.start.slice(11, 16));
  created.id = session.id;
  created.start = new Date(session.scheduledStart);
  created.end = new Date(session.scheduledEnd);
  const reservations = await query("SELECT 1 FROM session_reservations WHERE session_id = $1 AND status = 'RESERVED'", [session.id]);
  expect(reservations).toHaveLength(1);

  const teacher = await api("teacher");
  const mine = (await (await teacher.get("/api/sessions")).json()).data as { id: string }[];
  expect(mine.some((s) => s.id === session.id)).toBe(true);
});

test("booking rules answer with their codes", async ({ api }) => {
  const r = run();
  const admin = await api("admin");
  const s = r.fixtures.studentProfileIds;
  const code = async (data: Record<string, unknown>) => {
    const response = await admin.post("/api/sessions", { data });
    return { status: response.status(), code: (await response.json().catch(() => ({})))?.error?.code as string | undefined, body: response };
  };

  expect((await code({ bad: "payload" })).status).toBe(400);
  expect(await code(booking({ zoomJoinUrl: "http://zoom.us/j/123456789" }))).toMatchObject({ status: 400 });
  expect(await code(booking({ zoomJoinUrl: "https://zoom.us.evil.com/j/123456789" }))).toMatchObject({ status: 400, code: "INVALID_ZOOM_URL" });
  // In the past.
  expect((await code(booking({ scheduledStart: new Date(Date.now() - 3_600_000).toISOString(), scheduledEnd: new Date().toISOString() }))).status).toBeGreaterThanOrEqual(400);
  // Overlapping the session booked above.
  const overlap = await code(booking({
    scheduledStart: new Date(created.start!.getTime() + 30 * 60_000).toISOString(),
    scheduledEnd: new Date(created.start!.getTime() + 90 * 60_000).toISOString(),
    studentIds: [s.student3],
  }));
  expect(overlap).toMatchObject({ status: 409, code: "TEACHER_TIME_CONFLICT" });
  // Touching end == start is allowed.
  const boundary = await code(booking({
    scheduledStart: created.end!.toISOString(),
    scheduledEnd: new Date(created.end!.getTime() + 3_600_000).toISOString(),
    studentIds: [s.student3],
  }));
  expect(boundary.status, await boundary.body.text()).toBe(201);
  const boundaryId = (await boundary.body.json()).data.id as string;
  expect((await admin.patch(`/api/sessions/${boundaryId}`, { data: { status: "CANCELLED", cancellationReason: "e2e boundary" } })).ok()).toBe(true);
  // student10 has no active assignment with this teacher; student5 has no credit.
  expect(await code(booking({ studentIds: [s.student10] }))).toMatchObject({ status: 409, code: "STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT" });
  expect(await code(booking({ studentIds: [s.student5] }))).toMatchObject({ status: 409, code: "INSUFFICIENT_SESSION_CREDIT" });
  // A private session takes exactly one student; a group takes several.
  expect((await code(booking({ studentIds: [s.student3, s.student4] }))).status).toBe(400);
  const group = await code(booking({
    sessionType: "GROUP",
    scheduledStart: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 14 * 86_400_000 + 3_600_000).toISOString(),
    studentIds: [s.student3, s.student4],
  }));
  expect(group.status, await group.body.text()).toBe(201);
  const groupId = (await group.body.json()).data.id as string;
  expect((await admin.patch(`/api/sessions/${groupId}`, { data: { status: "CANCELLED", cancellationReason: "e2e group" } })).ok()).toBe(true);
});

test("teachers can only request changes, never book or edit", async ({ api }) => {
  const teacher = await api("teacher");
  expect((await teacher.post("/api/sessions", { data: booking() })).status()).toBe(403);
  expect((await teacher.patch(`/api/sessions/${created.id}`, { data: { status: "CANCELLED" } })).status()).toBe(403);
});

test("join links redirect to the stored Zoom link and log the click; outsiders get 404", async ({ api }) => {
  const r = run();
  const admin = await api("admin");
  const join = await admin.get(`/api/sessions/${r.ids.soonSession}/join`, { maxRedirects: 0 });
  expect([302, 307]).toContain(join.status());
  expect(join.headers()["location"]).toBe("https://zoom.us/j/700000004");

  const student = await api("student");
  const own = await student.get(`/api/sessions/${r.ids.soonSession}/join`, { maxRedirects: 0 });
  expect([302, 307]).toContain(own.status());
  expect(own.headers()["location"]).toBe("https://zoom.us/j/700000004");
  const clicks = await query("SELECT 1 FROM session_join_clicks WHERE session_id = $1", [r.ids.soonSession]);
  expect(clicks.length).toBeGreaterThanOrEqual(1);

  expect((await student.get(`/api/sessions/${r.ids.futureSession}/join`, { maxRedirects: 0 })).status()).toBe(404);
});

test("cancelling is idempotent, frees the credit, and kills the join link", async ({ api }) => {
  const admin = await api("admin");
  const cancel = () => admin.patch(`/api/sessions/${created.id}`, { data: { status: "CANCELLED", cancellationReason: "e2e cleanup" } });
  expect((await cancel()).ok()).toBe(true);
  expect((await cancel()).ok()).toBe(true);
  expect((await admin.get(`/api/sessions/${created.id}/join`, { maxRedirects: 0 })).status()).toBe(404);
  const reserved = await query("SELECT 1 FROM session_reservations WHERE session_id = $1 AND status = 'RESERVED'", [created.id]);
  expect(reserved).toHaveLength(0);
});
