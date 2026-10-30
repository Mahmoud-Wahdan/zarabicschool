import { run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/**
 * Enrollments page (owner, 2026-10-30/31): choosing a session asks the server for THAT
 * session's students only — who is in it (to remove) and who is assigned to its
 * teacher and subject (to add), each with its own button. Read only: the session used
 * is the fixture's private one, so the private-session rules are checked too.
 */
const t = messages.en.management.enrollments;

test("choosing a session loads only that session's students", async ({ open }) => {
  const r = run();
  const page = await open("admin");
  await visit(page, "/en/admin/enrollments");
  await expectHealthyPage(page, "en");
  await expect(page.getByRole("heading", { name: t.availableTitle })).toHaveCount(0);

  const loaded = page.waitForResponse((response) => response.url().includes(`/api/admin/enrollments?sessionId=${r.ids.futureSession}`) && response.request().method() === "GET");
  await page.getByLabel(t.sessionLabel, { exact: true }).selectOption(r.ids.futureSession);
  expect((await loaded).status()).toBe(200);

  const enrolled = page.locator("section", { has: page.getByRole("heading", { name: t.enrolledGroup }) });
  const available = page.locator("section", { has: page.getByRole("heading", { name: t.availableTitle }) });
  await expect(enrolled.getByRole("listitem")).toHaveText(["Demo Test student2"]);
  await expect(available.getByText("Demo Test student1", { exact: true })).toBeVisible();
  // Another teacher's student and an unassigned student are never offered.
  await expect(available.getByText("Demo Test student9", { exact: true })).toHaveCount(0);
  await expect(available.getByText("Demo Test student10", { exact: true })).toHaveCount(0);

  // A private session already has its student: nothing can be added or removed here.
  await expect(page.getByText(t.privateFull)).toBeVisible();
  await expect(page.getByText(t.privateNoRemove)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});
