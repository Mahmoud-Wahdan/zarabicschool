import { query } from "../support/db";
import { clientIp, run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/**
 * The public application form (Phase 2): it files into the academy that takes public
 * applications (the seed academy "Zarabicschool"), so the applicant name carries the
 * run marker and global teardown deletes exactly that row.
 */
const t = messages.en.applyForm;

test("a visitor picks a role, sees validation, applies as an adult student, and cannot apply twice in a day", async ({ open, api }) => {
  const { marker } = run();
  const phone = `010${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  const page = await open("anon", { ip: clientIp("apply-ui") });
  await visit(page, "/en/apply");
  await expectHealthyPage(page, "en");
  await visit(page, "/en/apply?type=student");
  await expectHealthyPage(page, "en");

  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.locator("p.text-error").first()).toBeVisible();

  await page.getByLabel(t.fullName).fill(`Public applicant ${marker}`);
  await page.getByLabel(t.phoneWhatsapp).fill(phone);
  await page.getByLabel(t.dateOfBirth).fill("1995-05-15");
  // Only the public academy's subjects are offered (none from the per-run test academies).
  await expect(page.getByRole("checkbox", { name: /Test Quran|Foreign Quran/ })).toHaveCount(0);
  await page.locator("input[type=checkbox]").first().check();
  await page.getByLabel(t.level).selectOption("beginner");
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByText(t.successTitle)).toBeVisible();

  const rows = await query<{ status: string; application_type: string }>(
    "SELECT status::text, application_type::text FROM applications WHERE details->>'full_name' = $1",
    [`Public applicant ${marker}`],
  );
  expect(rows).toEqual([{ status: "NEW", application_type: "STUDENT" }]);

  // Same phone and type within 24 hours → refused (no duplicate rows, no WhatsApp).
  const again = await (await api("anon", { ip: clientIp("apply-api") })).post("/api/applications", {
    data: { type: "STUDENT", full_name: `Public applicant ${marker} again`, phone_whatsapp: phone, date_of_birth: "1995-05-15", subjects: ["x"], level: "beginner" },
  });
  expect([400, 409]).toContain(again.status());
});

test("a filled honeypot gets a fake success and stores nothing (bots)", async ({ api }) => {
  const { marker } = run();
  const client = await api("anon", { ip: clientIp("apply-bot") });
  const response = await client.post("/api/applications", {
    data: {
      type: "STUDENT", full_name: `Bot ${marker}`, phone_whatsapp: "01011112222", date_of_birth: "1990-01-01",
      subjects: ["demo-quran"], level: "beginner", honeypot: "https://spam.example",
    },
  });
  expect(response.status()).toBe(201);
  const rows = await query("SELECT 1 FROM applications WHERE details->>'full_name' = $1", [`Bot ${marker}`]);
  expect(rows).toHaveLength(0);
});

test("the new application reaches the Admin's inbox of that academy only", async ({ api }) => {
  const r = run();
  // The per-run academy's Admin sees its own application, never the seed academy's.
  const admin = await api("admin");
  const list = await admin.get("/api/applications");
  expect(list.status()).toBe(200);
  const text = await list.text();
  expect(text).toContain(r.ids.application);
  expect(text).not.toContain(`Public applicant ${r.marker}`);
});
