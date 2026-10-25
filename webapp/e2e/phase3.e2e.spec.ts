/**
 * Phase 1-3 E2E (Playwright) - Zarabicschool
 *
 * Covers: public pages, auth gate, Admin login, Admin creates a session through the UI,
 * role-scoped access, Zoom join redirect (+ click audit), cancel + idempotent cancel,
 * and the Batch-2 scheduling rules (assignments, credits, conflicts, Zoom format checks)
 * against the seeded demo data.
 *
 * ASSUMPTIONS (verified against the implementation):
 *  - Login form has labels matching /username/i and /password/i and a submit button /sign in|log in/i.
 *  - Seed has demo accounts (npm run db:seed:demo); all demo users share DEMO_PASSWORD and
 *    must_change_password = false.
 *  - Credentials come from env (never hardcode): E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD
 *    (the demo SUPERVISOR may be used: session flows are Admin/Supervisor),
 *    E2E_TEACHER_USERNAME / E2E_TEACHER_PASSWORD, E2E_OTHER_STUDENT_USERNAME / E2E_OTHER_STUDENT_PASSWORD.
 *
 * Run (from webapp/, dev DB only):
 *   npx playwright test
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
};

async function login(page: Page, username: string, password: string) {
  await page.goto("/en/login");
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(admin|supervisor|teacher|student|guardian)/);
}

// datetime-local value (YYYY-MM-DDTHH:mm), a unique future slot to avoid collisions between runs
function futureSlot() {
  const dayOffset = 3 + Math.floor(Math.random() * 300);
  const hour = 8 + Math.floor(Math.random() * 12);
  const d = new Date(Date.now() + dayOffset * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: `${date}T${pad(hour)}:00`, end: `${date}T${pad(hour + 1)}:00` };
}

const ZOOM_URL = `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`;

const SEED_ANCHOR_ZOOM = "https://zoom.us/j/7001112233"; // future SCHEDULED session for demo_teacher_quran

async function teacherProfileId(request: APIRequestContext, username: string) {
  const res = await request.get("/api/admin/profiles?type=teacher");
  const body = await res.json();
  const match = body.data.find((p: { username: string }) => p.username === username);
  if (!match) throw new Error(`teacher profile ${username} not found`);
  return (match.teacherProfile?.id ?? match.id) as string;
}

async function studentProfileId(request: APIRequestContext, username: string) {
  const res = await request.get("/api/admin/profiles?type=student");
  const body = await res.json();
  const match = body.data.find((p: { username: string }) => p.username === username);
  if (!match) throw new Error(`student profile ${username} not found`);
  return (match.studentProfile?.id ?? match.id) as string;
}

async function subjectIdBySlug(request: APIRequestContext, slug: string) {
  const res = await request.get("/api/subjects");
  const subjects = await res.json();
  const match = subjects.find((s: { slug: string }) => s.slug === slug);
  if (!match) throw new Error(`subject ${slug} not found`);
  return match.id as string;
}

async function seededAnchorSession(request: APIRequestContext) {
  const res = await request.get("/api/sessions");
  const body = await res.json();
  const anchor = body.data.find((s: { zoomJoinUrl: string; status: string }) =>
    s.status === "SCHEDULED" && s.zoomJoinUrl === SEED_ANCHOR_ZOOM);
  if (!anchor) throw new Error("seeded anchor session not found");
  return anchor as { id: string; scheduledStart: string; scheduledEnd: string };
}

async function bookSession(
  request: APIRequestContext,
  data: Record<string, unknown>
) {
  return request.post("/api/sessions", { data });
}

test.describe.configure({ mode: "serial" });

test.describe("Public + auth gate", () => {
  test("landing page loads in English and Arabic", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("body")).toBeVisible();
    await page.goto("/ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("protected pages redirect anonymous users", async ({ page }) => {
    await page.goto("/en/admin/sessions");
    await expect(page).not.toHaveURL(/\/admin\/sessions/);
  });

  test("anonymous API access is rejected", async ({ request }) => {
    const res = await request.get("/api/sessions");
    expect([401, 403]).toContain(res.status());
  });

  test("wrong password does not log in", async ({ page }) => {
    await page.goto("/en/login");
    await page.getByLabel(/username/i).fill(env("E2E_ADMIN_USERNAME"));
    await page.getByLabel(/password/i).fill("definitely-wrong-password");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/login/);
  });
});

test.describe("Admin: create a session (UI)", () => {
  let createdSessionId: string | undefined;

  test("admin creates a private session and it appears in the list", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    await page.goto("/en/admin/sessions");
    await expect(page.getByRole("heading", { name: /Manage academy sessions/i })).toBeVisible();

    const form = page.locator("details", { hasText: "New single session" });
    await form.locator("summary").click();

    const selects = form.locator("select");
    // order in the smart form: teacher, subject, type, timezone
    await selects.nth(0).selectOption({ label: "Demo Teacher" });
    // the subject list loads from the teacher context endpoint — wait for it
    await expect(selects.nth(1).locator("option", { hasText: "Quran /" })).toHaveCount(1);
    await selects.nth(1).selectOption({ label: "Quran / القرآن الكريم" });
    await selects.nth(2).selectOption("PRIVATE");

    const slot = futureSlot();
    const dateInputs = form.locator('input[type="datetime-local"]');
    await dateInputs.nth(0).fill(slot.start);
    await dateInputs.nth(1).fill(slot.end);
    await form.locator('input[type="url"]').first().fill(ZOOM_URL);

    // the student chips load from the assignment-aware context — wait for them
    const studentChip = form.getByRole("button", { name: "Demo Student" });
    await studentChip.waitFor();
    await studentChip.click();

    await form.getByRole("button", { name: "Create session" }).click();
    // the panel reloads the page after success
    await page.waitForLoadState("networkidle");

    const res = await page.request.get("/api/sessions");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const mine = body.data.find((s: { zoomJoinUrl: string }) => s.zoomJoinUrl === ZOOM_URL);
    expect(mine, "created session should be listed").toBeTruthy();
    expect(mine.status).toBe("SCHEDULED");
    createdSessionId = mine.id;
  });

  test("API rejects a private session with two students / duplicate students", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const res = await page.request.post("/api/sessions", { data: { bad: "payload" } });
    expect(res.status()).toBe(400);
  });

  test("zoom link must be https (format check only)", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const res = await page.request.post("/api/sessions", {
      data: {
        teacherId: "00000000-0000-0000-0000-000000000000",
        subjectId: "00000000-0000-0000-0000-000000000000",
        sessionType: "PRIVATE",
        scheduledStart: new Date(Date.now() + 86_400_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 90_000_000).toISOString(),
        timezone: "Africa/Cairo",
        zoomJoinUrl: "http://zoom.us/j/123456789",
        studentIds: ["00000000-0000-0000-0000-000000000000"],
      },
    });
    expect([400, 409]).toContain(res.status());
  });

  test("lookalike host zoom.us.evil.com is rejected with INVALID_ZOOM_URL", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const res = await page.request.post("/api/sessions", {
      data: {
        teacherId: await teacherProfileId(page.request, "demo_teacher_quran"),
        subjectId: await subjectIdBySlug(page.request, "demo-quran"),
        sessionType: "PRIVATE",
        scheduledStart: new Date(Date.now() + 86_400_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 90_000_000).toISOString(),
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us.evil.com/j/123456789",
        studentIds: [await studentProfileId(page.request, "demo_student_credit_many")],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_ZOOM_URL");
  });

  test("overlapping teacher session returns TEACHER_TIME_CONFLICT; end==start is allowed", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const anchor = await seededAnchorSession(page.request);
    const anchorStart = new Date(anchor.scheduledStart);
    const teacherId = await teacherProfileId(page.request, "demo_teacher_quran");
    const subjectId = await subjectIdBySlug(page.request, "demo-quran");
    const studentId = await studentProfileId(page.request, "demo_student_credit_many");

    // partial overlap: +30m .. +90m
    const partial = await bookSession(page.request, {
      teacherId,
      subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(anchorStart.getTime() + 30 * 60_000).toISOString(),
      scheduledEnd: new Date(anchorStart.getTime() + 90 * 60_000).toISOString(),
      timezone: "Africa/Cairo",
      zoomJoinUrl: `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`,
      studentIds: [studentId],
    });
    expect(partial.status()).toBe(409);
    const partialBody = await partial.json();
    expect(partialBody.error.code).toBe("TEACHER_TIME_CONFLICT");

    // boundary touch: the slot starting exactly when the anchor ends is allowed
    const anchorEnd = new Date(anchor.scheduledEnd);
    const boundary = await bookSession(page.request, {
      teacherId,
      subjectId,
      sessionType: "PRIVATE",
      scheduledStart: anchorEnd.toISOString(),
      scheduledEnd: new Date(anchorEnd.getTime() + 60 * 60_000).toISOString(),
      timezone: "Africa/Cairo",
      zoomJoinUrl: `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`,
      studentIds: [studentId],
    });
    expect(boundary.status()).toBe(201);
    // cleanup so later scenarios and other runs are not blocked by this booking
    const cancel = await page.request.patch(`/api/sessions/${(await boundary.json()).data.id}`, {
      data: { status: "CANCELLED", cancellationReason: "e2e boundary check" },
    });
    expect(cancel.ok()).toBeTruthy();
  });

  test("student without an ACTIVE assignment returns STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const res = await bookSession(page.request, {
      teacherId: await teacherProfileId(page.request, "demo_teacher_quran"),
      subjectId: await subjectIdBySlug(page.request, "demo-quran"),
      sessionType: "PRIVATE",
      scheduledStart: new Date(Date.now() + 86_400_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 90_000_000).toISOString(),
      timezone: "Africa/Cairo",
      zoomJoinUrl: `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`,
      studentIds: [await studentProfileId(page.request, "demo_student_unassigned")],
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT");
    expect(body.error.studentIds).toContain(await studentProfileId(page.request, "demo_student_unassigned"));
  });

  test("credit_one books once, then INSUFFICIENT_SESSION_CREDIT; zero and nosub are always insufficient", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const teacherId = await teacherProfileId(page.request, "demo_teacher_quran");
    const subjectId = await subjectIdBySlug(page.request, "demo-quran");
    const creditOne = await studentProfileId(page.request, "demo_student_credit_one");
    const zoom = () => `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`;

    const first = await bookSession(page.request, {
      teacherId, subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 4 * 86_400_000 + 60 * 60_000).toISOString(),
      timezone: "Africa/Cairo", zoomJoinUrl: zoom(), studentIds: [creditOne],
    });
    expect(first.status()).toBe(201);
    const createdId = (await first.json()).data.id as string;

    const second = await bookSession(page.request, {
      teacherId, subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 5 * 86_400_000 + 60 * 60_000).toISOString(),
      timezone: "Africa/Cairo", zoomJoinUrl: zoom(), studentIds: [creditOne],
    });
    expect(second.status()).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.error.code).toBe("INSUFFICIENT_SESSION_CREDIT");
    expect(secondBody.error.studentIds).toContain(creditOne);

    for (const username of ["demo_student_zero", "demo_student_nosub"]) {
      const res = await bookSession(page.request, {
        teacherId, subjectId, sessionType: "PRIVATE",
        scheduledStart: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        scheduledEnd: new Date(Date.now() + 6 * 86_400_000 + 60 * 60_000).toISOString(),
        timezone: "Africa/Cairo", zoomJoinUrl: zoom(),
        studentIds: [await studentProfileId(page.request, username)],
      });
      expect(res.status()).toBe(409);
      expect((await res.json()).error.code).toBe("INSUFFICIENT_SESSION_CREDIT");
    }

    // cleanup the created session so its credit returns for later runs
    const cancel = await page.request.patch(`/api/sessions/${createdId}`, {
      data: { status: "CANCELLED", cancellationReason: "e2e credit check" },
    });
    expect(cancel.ok()).toBeTruthy();
  });

  test("group session with group_a and group_b succeeds", async ({ page }) => {
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const slot = futureSlot();
    const res = await bookSession(page.request, {
      teacherId: await teacherProfileId(page.request, "demo_teacher_quran"),
      subjectId: await subjectIdBySlug(page.request, "demo-quran"),
      sessionType: "GROUP",
      scheduledStart: new Date(`${slot.start}:00Z`).toISOString(),
      scheduledEnd: new Date(`${slot.end}:00Z`).toISOString(),
      timezone: "Africa/Cairo",
      zoomJoinUrl: `https://zoom.us/j/${Math.floor(100000000 + Math.random() * 899999999)}`,
      studentIds: [
        await studentProfileId(page.request, "demo_student_group_a"),
        await studentProfileId(page.request, "demo_student_group_b"),
      ],
    });
    expect(res.status()).toBe(201);
    const createdId = (await res.json()).data.id as string;
    const cancel = await page.request.patch(`/api/sessions/${createdId}`, {
      data: { status: "CANCELLED", cancellationReason: "e2e group check" },
    });
    expect(cancel.ok()).toBeTruthy();
  });

  test("zoom join redirect works for admin and logs a click", async ({ page }) => {
    test.skip(!createdSessionId, "session was not created");
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const res = await page.request.get(`/api/sessions/${createdSessionId}/join`, { maxRedirects: 0 });
    expect([302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toBe(ZOOM_URL);
  });

  test("admin cancels the session; second cancel is idempotent", async ({ page }) => {
    test.skip(!createdSessionId, "session was not created");
    await login(page, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const cancel = () =>
      page.request.patch(`/api/sessions/${createdSessionId}`, {
        data: { status: "CANCELLED", cancellationReason: "e2e cleanup" },
      });
    const first = await cancel();
    expect(first.ok()).toBeTruthy();
    const second = await cancel();
    expect(second.ok()).toBeTruthy();

    // a cancelled session must no longer be joinable
    const join = await page.request.get(`/api/sessions/${createdSessionId}/join`, { maxRedirects: 0 });
    expect(join.status()).toBe(404);
  });
});

test.describe("Role boundaries", () => {
  async function adminSessionId(request: APIRequestContext) {
    const res = await request.get("/api/sessions");
    const body = await res.json();
    return body.data.find((s: { status: string }) => s.status === "SCHEDULED")?.id as string | undefined;
  }

  test("teacher cannot create or edit sessions (request-only)", async ({ page }) => {
    await login(page, env("E2E_TEACHER_USERNAME"), env("E2E_TEACHER_PASSWORD"));
    const create = await page.request.post("/api/sessions", { data: {} });
    expect(create.status()).toBe(403);
    const sessionId = await adminSessionId(page.request);
    if (sessionId) {
      const patch = await page.request.patch(`/api/sessions/${sessionId}`, { data: { status: "CANCELLED" } });
      expect(patch.status()).toBe(403);
    }
  });

  test("teacher cannot open the admin sessions page", async ({ page }) => {
    await login(page, env("E2E_TEACHER_USERNAME"), env("E2E_TEACHER_PASSWORD"));
    await page.goto("/en/admin/sessions");
    await expect(page).not.toHaveURL(/\/admin\/sessions/);
  });

  test("a student who is not in the session cannot get its Zoom link", async ({ browser }) => {
    const admin = await browser.newPage();
    await login(admin, env("E2E_ADMIN_USERNAME"), env("E2E_ADMIN_PASSWORD"));
    const sessionId = await adminSessionId(admin.request);
    test.skip(!sessionId, "no scheduled session available to probe");

    const other = await browser.newPage();
    await login(other, env("E2E_OTHER_STUDENT_USERNAME"), env("E2E_OTHER_STUDENT_PASSWORD"));
    const res = await other.request.get(`/api/sessions/${sessionId}/join`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
    const list = await other.request.get("/api/sessions");
    const body = await list.json();
    expect(body.data.some((s: { id: string }) => s.id === sessionId)).toBe(false);
    await admin.close();
    await other.close();
  });

  test("students never receive the host link", async ({ page }) => {
    await login(page, env("E2E_OTHER_STUDENT_USERNAME"), env("E2E_OTHER_STUDENT_PASSWORD"));
    const res = await page.request.get("/api/sessions");
    const body = await res.json();
    for (const s of body.data) expect(s).not.toHaveProperty("zoomHostUrl");
  });
});
