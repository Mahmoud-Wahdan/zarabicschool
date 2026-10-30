import { randomUUID } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/**
 * test-plan-session1.md §5.1 (multilingual report, LTR body inside RTL chrome),
 * the visibility rules of §3.3, §5.3 (the Admin's side-by-side decision workspace,
 * no automatic conflict flag) and the approval chain: reject with a mandatory reason,
 * resubmit, approve → settlement rows.
 */
test.describe.configure({ mode: "serial" });

const tag = randomUUID().slice(0, 6);
const SUMMARY = `Résumé E2E ${tag}: lecture et récitation`;
const HOMEWORK = `Devoirs E2E ${tag}: réviser la sourate`;

test("§5.1 the teacher writes the report in the student's language (French), whatever the UI language", async ({ open }) => {
  const r = run();
  const page = await open("teacher");
  await visit(page, `/en/teacher/sessions/${r.ids.reportSession}/report?studentId=${r.fixtures.studentProfileIds.student1}`);
  await expect(page.getByLabel("Langue du rapport")).toHaveValue("fr");
  const form = page.locator("form[lang='fr']");
  await expect(form).toHaveAttribute("dir", "ltr");
  await expect(form.getByText("Résumé du cours")).toBeVisible();
  await expect(form.getByText("Devoirs", { exact: true })).toBeVisible();

  await page.getByLabel("Remarque sur le cours").selectOption("very_good");
  await page.getByLabel("Résumé du cours").fill(SUMMARY);
  await page.getByLabel("Devoirs").fill(HOMEWORK);
  await page.getByRole("button", { name: "Envoyer le rapport" }).click();
  await expect(page.getByText(messages.en.teacherReport.submittedMessage)).toBeVisible();

  const rows = await query<{ status: string; language: string }>(
    "SELECT status, language::text FROM reports WHERE session_id = $1 AND student_id = $2",
    [r.ids.reportSession, r.fixtures.studentProfileIds.student1],
  );
  expect(rows).toEqual([{ status: "SUBMITTED", language: "fr" }]);
  // Delivery is decoupled from approval: the family notice is queued on submit.
  const jobs = await query<{ recipient_user_id: string }>(
    `SELECT j.recipient_user_id FROM notification_jobs j JOIN reports r ON r.id = j.report_id
      WHERE r.session_id = $1 AND j.kind = 'REPORT_SUBMITTED'`,
    [r.ids.reportSession],
  );
  expect(jobs.map((job) => job.recipient_user_id).sort()).toEqual(
    [r.fixtures.guardianUserId, r.fixtures.studentUserIds.student1].sort(),
  );
});

test("§5.1 the guardian sees it at once, before any approval: French LTR body inside Arabic RTL chrome", async ({ open }) => {
  const page = await open("guardian", { locale: "ar" });
  await visit(page, "/ar/guardian/reports");
  await expectHealthyPage(page, "ar");
  const article = page.locator("article", { hasText: SUMMARY });
  await expect(article).toHaveAttribute("lang", "fr");
  await expect(article).toHaveAttribute("dir", "ltr");
  await expect(article).toContainText(HOMEWORK);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("§3.3 a student who has a guardian sees the homework but not the teacher's summary", async ({ open }) => {
  const page = await open("student");
  await visit(page, "/en/student/reports");
  await expectHealthyPage(page, "en");
  await expect(page.getByText(HOMEWORK).first()).toBeVisible();
  await expect(page.getByText(SUMMARY)).toHaveCount(0);
});

test("§5.3 the Admin's session record shows report, attendance and settlement side by side, and decides nothing", async ({ open }) => {
  const r = run();
  const page = await open("admin");
  await visit(page, `/en/admin/sessions/${r.ids.reportSession}`);
  await expectHealthyPage(page, "en");
  const t = messages.en.adminSessionDetail;
  await expect(page.getByText(t.teacherReportPanel).first()).toBeVisible();
  await expect(page.getByText(SUMMARY).first()).toBeVisible();
  await expect(page.getByText(t.evaluationsPanel).first()).toBeVisible();
  await expect(page.getByText(t.settlementTitle).first()).toBeVisible();
  await expect(page.getByText(t.recordingPrinciple)).toBeVisible();
  const main = await page.locator("main").innerText();
  expect(main).not.toMatch(/\b(conflict|discrepancy|mismatch)\b/i);
});

test("§4.4 Teacher, student and guardian are turned away from the session record", async ({ open }) => {
  const r = run();
  for (const who of ["teacher", "student", "guardian"] as const) {
    const page = await open(who);
    await visit(page, `/en/admin/sessions/${r.ids.reportSession}`);
    expect(new URL(page.url()).pathname, who).not.toContain("/admin/sessions");
  }
});

test("the Supervisor rejects with a mandatory reason; the teacher corrects; the Supervisor approves and the session settles", async ({ open, api }) => {
  const r = run();
  const studentId = r.fixtures.studentProfileIds.student2;
  const teacher = await api("teacher");
  const submit = (summary: string) =>
    teacher.post(`/api/sessions/${r.ids.approvalSession}/students/${studentId}/report`, {
      data: { attendanceOutcome: "ATTENDED", classRemark: "good", summary, homework: "Read page 3", language: "en" },
    });
  expect((await submit(`First draft ${tag}`)).status()).toBe(201);

  const page = await open("supervisor");
  const t = messages.en.reportsQueue;
  await visit(page, "/en/supervisor/reports");
  await page.getByRole("button", { name: /Demo Test student2/ }).first().click();
  await page.getByRole("button", { name: t.reject }).click();
  const confirm = page.getByRole("button", { name: t.confirmReject });
  await expect(confirm).toBeDisabled(); // no reason, no rejection
  await page.getByLabel(t.rejectReasonLabel).fill("Please add what was recited.");
  await confirm.click();
  await expect.poll(async () => (await query<{ status: string }>("SELECT status FROM reports WHERE session_id = $1", [r.ids.approvalSession]))[0]?.status).toBe("REJECTED");

  const corrected = await submit(`Corrected ${tag}: recited verses 1-10`);
  expect(corrected.status(), await corrected.text()).toBeLessThan(300);
  const counter = await query<{ rejection_count: number; status: string }>(
    "SELECT rejection_count, status FROM reports WHERE session_id = $1",
    [r.ids.approvalSession],
  );
  expect(counter[0]).toEqual({ rejection_count: 1, status: "SUBMITTED" });

  await visit(page, "/en/supervisor/reports");
  await page.getByRole("button", { name: /Demo Test student2/ }).first().click();
  await page.getByRole("button", { name: t.approve }).click();
  await expect.poll(async () => (await query<{ status: string }>("SELECT status FROM reports WHERE session_id = $1", [r.ids.approvalSession]))[0]?.status).toBe("APPROVED");

  // One atomic settlement: the teacher's credit and the student's session deduction.
  const payroll = await query("SELECT 1 FROM payroll_ledger WHERE session_id = $1 AND entry_type = 'SESSION_CREDIT'", [r.ids.approvalSession]);
  expect(payroll).toHaveLength(1);
  const deduction = await query("SELECT 1 FROM subscription_ledger WHERE session_id = $1 AND entry_type = 'SESSION_DEDUCTION'", [r.ids.approvalSession]);
  expect(deduction).toHaveLength(1);

  // The Admin sees the ledger on the session record; the Supervisor never sees amounts.
  const admin = await open("admin");
  await visit(admin, `/en/admin/sessions/${r.ids.approvalSession}`);
  await expect(admin.getByText(messages.en.adminSessionDetail.payrollType.SESSION_CREDIT).first()).toBeVisible();
  await visit(page, `/en/admin/sessions/${r.ids.approvalSession}`);
  await expect(page.getByText(messages.en.adminSessionDetail.payrollType.SESSION_CREDIT)).toHaveCount(0);
});

test("an approved report is read-only for the teacher (no second settlement)", async ({ api }) => {
  const r = run();
  const teacher = await api("teacher");
  const again = await teacher.post(`/api/sessions/${r.ids.approvalSession}/students/${r.fixtures.studentProfileIds.student2}/report`, {
    data: { attendanceOutcome: "STUDENT_ABSENT", classRemark: "good", summary: "Try to change", homework: "x", language: "en" },
  });
  expect(again.status()).toBeGreaterThanOrEqual(400);
  const payroll = await query("SELECT 1 FROM payroll_ledger WHERE session_id = $1", [r.ids.approvalSession]);
  expect(payroll).toHaveLength(1);
});
