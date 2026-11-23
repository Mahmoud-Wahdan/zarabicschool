import { expect, test } from "@playwright/test";

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
    await expect(page.getByText("Amina Student").first()).toBeVisible();
    await expect(page.getByText("2012").first()).toBeVisible();
    await expect(page.getByText("Layla Guardian").first()).toBeVisible();

    const disclosure = page.getByLabel(locale === "ar" ? /تفاصيل علاقات/ : /Relationship details/).first();
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(locale === "ar" ? "القرآن" : "Quran").first()).toBeVisible();
    await expect(page.getByText(/Omar Teacher/).first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
