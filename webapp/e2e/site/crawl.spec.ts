import { query } from "../support/db";
import { BASE_URL, clientIp, run, statePath, type RoleKey } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit, type Locale } from "../support/test";

/**
 * Every page of the site, for every role that may open it, in Arabic (RTL) and
 * English (LTR): it answers below 400, stays on its own URL (no redirect away), and
 * renders a heading with no error boundary, 404 view, raw translation key or
 * uncaught exception (expectHealthyPage).
 */
const cairoMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());

function pagesFor(role: RoleKey, ids: { complaint: string | null }): string[] {
  const r = run();
  const sessionDetail = `/admin/sessions/${r.ids.reportSession}`;
  const operator = [
    "/admin/students", "/admin/teachers", "/admin/guardians", "/admin/subjects", "/admin/assignments",
    "/admin/enrollments", "/admin/sessions", sessionDetail, "/admin/schedule", "/admin/schedule?view=week&teacherId=" + r.fixtures.teacherProfileId,
    "/admin/complaints", "/admin/evaluations",
    "/admin/announcements", ...(ids.complaint ? [`/admin/complaints/${ids.complaint}`] : []),
  ];
  const shared = ["/account", "/notifications"];
  const family = ["/announcements", "/complaints/new", ...shared];
  switch (role) {
    case "admin":
      return [
        "/admin", "/admin/applications", `/admin/applications/${r.ids.application}`, ...operator,
        "/admin/reports", "/admin/monthly-reports", "/admin/session-requests", "/admin/financials", "/admin/billing",
        "/admin/invoices", "/admin/renewals", "/admin/payment-audit", "/admin/whatsapp", "/admin/payroll",
        "/admin/overtime", "/admin/performance", "/admin/users", ...shared,
      ];
    case "supervisor":
      return ["/supervisor", "/supervisor/reports", "/supervisor/monthly-reports", "/supervisor/session-requests", ...operator, ...shared];
    case "teacher":
      return [
        "/teacher", "/teacher/sessions", "/teacher/calendar", "/teacher/monthly-reports",
        // The form opens for students taught in the chosen month (default: last month).
        `/teacher/monthly-reports/${r.fixtures.studentProfileIds.student1}?month=${cairoMonth()}`, "/teacher/attendance", "/teacher/indicators",
        "/teacher/payroll", `/teacher/sessions/${r.ids.reportSession}/report?studentId=${r.fixtures.studentProfileIds.student1}`,
        ...family,
      ];
    case "guardian":
      return [
        "/guardian", "/guardian/sessions", "/guardian/calendar", "/guardian/attendance", "/guardian/reports",
        "/guardian/monthly-reports", "/guardian/invoices", ...family,
      ];
    case "student":
      return [
        "/student", "/student/sessions", "/student/calendar", "/student/attendance", "/student/reports",
        "/student/monthly-reports", `/student/sessions/${r.ids.reportSession}/report`, ...family,
      ];
    case "adult":
      return ["/student", "/student/sessions", "/student/invoices", "/student/reports", ...family];
  }
}

const complaint: { id: string | null } = { id: null };

test.beforeAll(async ({ playwright }) => {
  const r = run();
  // One complaint in this academy so its detail page has something to show.
  const guardian = await playwright.request.newContext({
    baseURL: BASE_URL,
    storageState: statePath("guardian"),
    extraHTTPHeaders: { origin: BASE_URL, "x-forwarded-for": clientIp("crawl-setup") },
  });
  const filed = await guardian.post("/api/complaints", {
    data: {
      sessionId: r.ids.absentSession,
      concernedUserId: r.fixtures.teacherUserId,
      category: "PUNCTUALITY",
      title: "E2E crawl complaint",
      body: "Filed by the E2E crawl so the detail page has data.",
    },
  });
  expect(filed.status(), await filed.text()).toBe(201);
  await guardian.dispose();
  const rows = await query<{ id: string }>("SELECT id FROM complaints WHERE academy_id = $1 ORDER BY created_at DESC LIMIT 1", [r.fixtures.academyId]);
  complaint.id = rows[0]?.id ?? null;
});

for (const role of ["admin", "supervisor", "teacher", "guardian", "student", "adult"] as const) {
  for (const locale of ["ar", "en"] as Locale[]) {
    test(`${role} (${locale}): every page renders`, async ({ open }) => {
      const page = await open(role, { locale });
      for (const path of pagesFor(role, { complaint: complaint.id })) {
        await test.step(path, async () => {
          const response = await visit(page, `/${locale}${path}`);
          expect.soft(response?.status() ?? 0, `${path}: status`).toBeLessThan(400);
          expect.soft(new URL(page.url()).pathname, `${path}: stayed on the page`).toBe(`/${locale}${path.split("?")[0]}`);
          await expectHealthyPage(page, locale, path);
        });
      }
    });
  }
}

test.describe("public pages", () => {
  for (const locale of ["ar", "en"] as Locale[]) {
    test(`anonymous (${locale}): landing, apply, login, join status, payment return`, async ({ open }) => {
      const page = await open("anon", { locale });
      for (const path of ["", "/apply", "/login", "/join-status", "/payments/paymob/return"]) {
        await test.step(path || "/", async () => {
          const response = await visit(page, `/${locale}${path}`);
          expect.soft(response?.status() ?? 0, `${path}: status`).toBeLessThan(400);
          await expectHealthyPage(page, locale, path || "/");
        });
      }
    });

    test(`anonymous (${locale}): an unknown path shows the localized 404 page, not indexed`, async ({ open }) => {
      const page = await open("anon", { locale });
      const response = await visit(page, `/${locale}/e2e-no-such-page`);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(page.getByText(messages[locale].notFound.title).first()).toBeVisible();
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
      // Known gap (soft 404): app/[locale]/loading.tsx starts the stream before notFound()
      // runs, so the status is already 200. Recorded, not hidden.
      test.info().annotations.push({ type: "status", description: `unknown page answered HTTP ${response?.status()}` });
    });
  }

  test("the bare root picks the locale from the browser language, Arabic by default", async ({ open }) => {
    for (const [browserLocale, expected] of [["ar", "/ar"], ["en", "/en"]] as const) {
      const page = await open("anon", { locale: browserLocale });
      await visit(page, "/");
      expect(new URL(page.url()).pathname).toBe(expected);
    }
    const unsupported = await open("anon", { browserLocale: "fr-FR" });
    await visit(unsupported, "/");
    expect(new URL(unsupported.url()).pathname).toBe("/ar");
    await expect(unsupported.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
