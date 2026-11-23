import { expect, test, type Locator, type Page } from "@playwright/test";

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.locator("html").evaluate((root, value) => root.setAttribute("data-theme", value), theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect.poll(() => page.locator("html").evaluate((root) => getComputedStyle(root).getPropertyValue("--background").trim()))
    .toBe(theme === "dark" ? "#0d1420" : "#f8f9ff");
}

async function checkDesktopProfileLayout(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.locator("table")).toBeVisible();
  const tableRegion = page.getByRole("region").filter({ has: page.locator("table") });
  await expect(tableRegion).toHaveAttribute("tabindex", "0");
  await expect(tableRegion).toHaveAttribute("aria-label", /\S+/);
}

async function checkMobileProfileLayout(page: Page, disclosure: Locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.locator("table")).toBeHidden();
  await expect(disclosure).toBeVisible();
}

for (const locale of ["en", "ar"] as const) {
  test(`student profile relations are visible and keyboard expandable in ${locale}`, async ({ page }) => {
    const request = page.context().request;
    const csrf = await (await request.get("/api/auth/csrf")).json();
    await request.post("/api/auth/callback/credentials", {
      form: {
        csrfToken: csrf.csrfToken,
        username: process.env.SEED_ADMIN_USERNAME ?? "",
        password: process.env.QA_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "",
        json: "true",
      },
    });

    await page.route("**/api/admin/profiles?type=student", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [{
          id: "student-1",
          username: "student.one",
          displayName: "Amina Student",
          phone: "+201000000001",
          isActive: true,
          dateOfBirth: "2012-05-10",
          financeStatus: { remainingSessions: 6, paymentStatus: "PAID" },
          studentProfile: {
            guardianId: "guardian-1",
            isAdult: false,
            guardian: { displayName: "Layla Guardian", phone: "+201000000002", relationship: "MOTHER" },
            activeAssignments: [{ subjectId: "subject-1", subjectNameAr: "القرآن", subjectNameEn: "Quran", teacherName: "Omar Teacher" }],
          },
        }] }),
      });
    });

    await page.goto(`/${locale}/admin/students`);
    await setTheme(page, "light");
    await checkDesktopProfileLayout(page);
    const mobileDisclosure = page.getByLabel(locale === "ar" ? /\u062A\u0641\u0627\u0635\u064A\u0644 \u0639\u0644\u0627\u0642\u0627\u062A/ : /Relationship details/).nth(1);
    await expect(page.getByText("Amina Student").first()).toBeVisible();
    const birthDate = new Date("2012-05-10T00:00:00Z");
    const today = new Date();
    const expectedAge = today.getUTCFullYear() - birthDate.getUTCFullYear() - (
      today.getUTCMonth() < birthDate.getUTCMonth() ||
      (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate()) ? 1 : 0
    );
    await expect(page.getByText(`${locale === "ar" ? "\u0627\u0644\u0639\u0645\u0631" : "Age"}: ${expectedAge}`).first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "\u0642\u0627\u0635\u0631" : "Minor", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("2012").first()).toBeVisible();
    await expect(page.getByText("Layla Guardian").first()).toBeVisible();

    const disclosure = page.getByLabel(locale === "ar" ? /تفاصيل علاقات/ : /Relationship details/).first();
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "القرآن" : "Quran").first()).toBeVisible();
    await expect(page.getByText(/Omar Teacher/).first()).toBeVisible();

    await checkMobileProfileLayout(page, mobileDisclosure);
    await mobileDisclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "\u0627\u0644\u0642\u0631\u0622\u0646" : "Quran").first()).toBeVisible();
    await expect(page.getByText(/Omar Teacher/).first()).toBeVisible();
    await setTheme(page, "dark");
    await checkDesktopProfileLayout(page);
    await checkMobileProfileLayout(page, mobileDisclosure);
    await expect(page.getByText(locale === "ar" ? "\u0627\u0644\u0642\u0631\u0622\u0646" : "Quran").first()).toBeVisible();
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`guardian profile relations are visible in ${locale}`, async ({ page }) => {
    const request = page.context().request;
    const csrf = await (await request.get("/api/auth/csrf")).json();
    await request.post("/api/auth/callback/credentials", {
      form: {
        csrfToken: csrf.csrfToken,
        username: process.env.SEED_ADMIN_USERNAME ?? "",
        password: process.env.QA_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "",
        json: "true",
      },
    });

    await page.route("**/api/admin/profiles?type=guardian", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [{
          id: "guardian-1",
          username: "layla.guardian",
          displayName: "Layla Guardian",
          phone: "+201000000002",
          isActive: true,
          guardianProfile: {
            relationship: "MOTHER",
            students: [{
              id: "student-1",
              displayName: "Amina Student",
              dateOfBirth: "2012-05-10",
              isAdult: false,
              assignments: [{ subjectId: "subject-1", subjectNameAr: "القرآن", subjectNameEn: "Quran", teacherName: "Omar Teacher" }],
            }],
          },
        }, {
          id: "guardian-2",
          username: "no.children",
          displayName: "Empty Guardian",
          phone: "+201000000003",
          isActive: false,
          guardianProfile: { relationship: "FATHER", students: [] },
        }] }),
      });
    });

    await page.goto(`/${locale}/admin/guardians`);
    await setTheme(page, "light");
    await checkDesktopProfileLayout(page);
    const mobileDisclosure = page.getByLabel(locale === "ar" ? /\u062A\u0641\u0627\u0635\u064A\u0644 \u0639\u0644\u0627\u0642\u0627\u062A/ : /Relationship details for Layla Guardian/).nth(1);
    await expect(page.getByText("Layla Guardian").first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "الأم" : "Mother").first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "طفل مرتبط واحد" : "1 linked child", { exact: false }).first()).toBeVisible();

    const disclosure = page.getByLabel(locale === "ar" ? /تفاصيل علاقات/ : /Relationship details/).first();
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Amina Student").first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "قاصر" : "Minor", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("2012").first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "القرآن" : "Quran").first()).toBeVisible();
    await expect(page.getByText(/Omar Teacher/).first()).toBeVisible();

    await expect(page.getByText("Empty Guardian").first()).toBeVisible();
    const emptyDisclosure = page.getByLabel(locale === "ar" ? /تفاصيل علاقات Empty Guardian/ : /Relationship details for Empty Guardian/).first();
    await emptyDisclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "لا يوجد أبناء مرتبطون." : "No linked children.").first()).toBeVisible();

    await checkMobileProfileLayout(page, mobileDisclosure);
    await mobileDisclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "\u0627\u0644\u0642\u0631\u0622\u0646" : "Quran").first()).toBeVisible();
    await expect(page.getByText(/Omar Teacher/).first()).toBeVisible();
    await setTheme(page, "dark");
    await checkDesktopProfileLayout(page);
    await checkMobileProfileLayout(page, mobileDisclosure);
    await expect(page.getByText(locale === "ar" ? "\u0627\u0644\u0642\u0631\u0622\u0646" : "Quran").first()).toBeVisible();
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`teacher profile subject relations are visible in ${locale}`, async ({ page }) => {
    const request = page.context().request;
    const csrf = await (await request.get("/api/auth/csrf")).json();
    await request.post("/api/auth/callback/credentials", {
      form: {
        csrfToken: csrf.csrfToken,
        username: process.env.SEED_ADMIN_USERNAME ?? "",
        password: process.env.QA_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "",
        json: "true",
      },
    });

    await page.route("**/api/admin/profiles?type=teacher", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [{
          id: "teacher-1", username: "omar.teacher", displayName: "Omar Teacher", phone: "+201000000010", isActive: true,
          teacherProfile: { id: "teacher-profile-1", approvalStatus: "APPROVED", subjects: [{ id: "subject-1", nameAr: "القرآن", nameEn: "Quran" }, { id: "subject-2", nameAr: "التجويد", nameEn: "Tajweed" }], studentsBySubject: { "subject-1": [{ id: "student-1", displayName: "Amina Student", isAdult: false }], "subject-2": [] } },
        }, {
          id: "teacher-2", username: "empty.teacher", displayName: "Empty Teacher", phone: "+201000000011", isActive: false,
          teacherProfile: { id: "teacher-profile-2", approvalStatus: "APPROVED", subjects: [], studentsBySubject: {} },
        }] }),
      });
    });

    await page.goto(`/${locale}/admin/teachers`);
    await setTheme(page, "light");
    await checkDesktopProfileLayout(page);
    const mobileDisclosure = page.getByLabel(locale === "ar" ? /\u062A\u0641\u0627\u0635\u064A\u0644 \u0639\u0644\u0627\u0642\u0627\u062A Omar Teacher/ : /Relationship details for Omar Teacher/).nth(1);
    await expect(page.getByText(locale === "ar" ? "مادتان" : "2 subjects", { exact: true }).first()).toBeVisible();

    const disclosure = page.getByLabel(locale === "ar" ? /تفاصيل علاقات Omar Teacher/ : /Relationship details for Omar Teacher/).first();
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "القرآن" : "Quran").first()).toBeVisible();
    await expect(page.getByText("Amina Student").first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "التجويد" : "Tajweed").first()).toBeVisible();
    await expect(page.getByText(locale === "ar" ? "لا يوجد طلاب نشطون مسندون لهذه المادة." : "No active assigned students.").first()).toBeVisible();

    const emptyDisclosure = page.getByLabel(locale === "ar" ? /تفاصيل علاقات Empty Teacher/ : /Relationship details for Empty Teacher/).first();
    await emptyDisclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "لا توجد مواد بعد." : "No subjects yet.").first()).toBeVisible();

    await checkMobileProfileLayout(page, mobileDisclosure);
    await mobileDisclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "\u0627\u0644\u0642\u0631\u0622\u0646" : "Quran").first()).toBeVisible();
    await expect(page.getByText(/Omar Teacher/).first()).toBeVisible();
    await setTheme(page, "dark");
    await checkDesktopProfileLayout(page);
    await checkMobileProfileLayout(page, mobileDisclosure);
    await expect(page.getByText(locale === "ar" ? "\u0627\u0644\u0642\u0631\u0622\u0646" : "Quran").first()).toBeVisible();
  });
}
