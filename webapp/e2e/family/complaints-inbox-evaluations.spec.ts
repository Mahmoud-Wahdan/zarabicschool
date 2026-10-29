import { randomUUID } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/**
 * Phase 7 family-facing journeys: a complaint filed through the form and handled to
 * "resolved" (the concerned party is never notified); the in-app inbox; session
 * evaluations that the teacher can never see.
 */
test.describe.configure({ mode: "serial" });

const tag = randomUUID().slice(0, 6);

test("a teacher files a complaint through the form; Admin handles and resolves it; nobody is notified", async ({ open }) => {
  const r = run();
  const title = `Late join ${tag}`;
  const form = messages.en.complaintForm;
  const page = await open("teacher");
  await visit(page, "/en/complaints/new");
  await expectHealthyPage(page, "en");
  const session = page.getByLabel(form.sessionLabel);
  await session.selectOption({ index: 1 });
  const concerned = page.getByLabel(form.concernedLabel);
  await expect(concerned.locator("option")).not.toHaveCount(1);
  await concerned.selectOption({ index: 1 });
  await page.getByLabel(form.categoryLabel).selectOption("PUNCTUALITY");
  await page.getByLabel(form.titleLabel).fill(title);
  await page.getByLabel(form.bodyLabel).fill("The student joined twenty minutes late.");
  await page.getByRole("button", { name: form.submit }).click();
  await expect(page.getByText(form.sentTitle)).toBeVisible();

  const [complaint] = await query<{ id: string; concerned_user_id: string | null }>(
    "SELECT id, concerned_user_id FROM complaints WHERE academy_id = $1 AND title = $2",
    [r.fixtures.academyId, title],
  );
  expect(complaint).toBeDefined();

  const t = messages.en.complaintsAdmin;
  const admin = await open("admin");
  await visit(admin, "/en/admin/complaints");
  await admin.getByText(title).first().click();
  await admin.waitForURL(`**/en/admin/complaints/${complaint.id}`);
  await expect(admin.getByText(t.manualInformHint)).toBeVisible();
  await admin.getByRole("button", { name: t.startAction }).click();
  await expect(admin.getByText(t.status.IN_PROGRESS).first()).toBeVisible();
  await admin.getByLabel(t.resolutionNoteLabel).fill("Spoke with the family; agreed on a reminder.");
  await admin.getByRole("button", { name: t.resolveAction }).click();
  await expect(admin.getByText(t.status.RESOLVED).first()).toBeVisible();
  const [state] = await query<{ status: string }>("SELECT status::text FROM complaints WHERE id = $1", [complaint.id]);
  expect(state.status).toBe("RESOLVED");

  // Filing and resolving create no notification for anyone (owner rule).
  if (complaint.concerned_user_id) {
    const jobs = await query("SELECT 1 FROM notification_jobs WHERE recipient_user_id = $1 AND kind ILIKE '%COMPLAINT%'", [complaint.concerned_user_id]);
    expect(jobs).toHaveLength(0);
  }
});

test("the guardian's inbox shows the new report and can be marked read", async ({ open, api }) => {
  const r = run();
  const teacher = await api("teacher");
  const submitted = await teacher.post(`/api/sessions/${r.ids.absentSession}/students/${r.fixtures.studentProfileIds.student3}/report`, {
    data: { attendanceOutcome: "STUDENT_ABSENT", classRemark: "acceptable", summary: `Absent ${tag}`, homework: "Revise lesson 2", language: "en" },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);

  const page = await open("guardian");
  await visit(page, "/en/notifications");
  await expectHealthyPage(page, "en");
  await expect(page.getByText(messages.en.inbox.kind.REPORT_SUBMITTED).first()).toBeVisible();
  await page.getByRole("button", { name: messages.en.inbox.markAll }).click();
  await expect(page.getByText(messages.en.inbox.allRead)).toBeVisible();
});

test("the guardian evaluates the session; Admin sees it on the record; the teacher has no way to read it", async ({ api, open }) => {
  const r = run();
  const guardian = await api("guardian");
  const comment = `Very patient teacher ${tag}`;
  const rated = await guardian.post(`/api/sessions/${r.ids.absentSession}/evaluations`, { data: { rating: 4, comment } });
  expect(rated.status(), await rated.text()).toBeLessThan(300);

  const teacher = await api("teacher");
  expect((await teacher.get(`/api/sessions/${r.ids.absentSession}/evaluations`)).status()).toBe(403);
  const teacherPage = await open("teacher");
  for (const path of ["/en/teacher", "/en/teacher/sessions", "/en/teacher/indicators"]) {
    await visit(teacherPage, path);
    await expect(teacherPage.getByText(comment)).toHaveCount(0);
  }

  const admin = await open("admin");
  await visit(admin, `/en/admin/sessions/${r.ids.absentSession}`);
  await expect(admin.getByText(messages.en.adminSessionDetail.evaluationAuthorGuardian).first()).toBeVisible();
  await expect(admin.getByText(comment)).toBeVisible();
});
