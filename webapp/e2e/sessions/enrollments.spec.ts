import { run } from "../support/run";
import { expect, expectHealthyPage, messages, test, visit } from "../support/test";

/**
 * Enrollments page (owner, 2026-10-30): the student list is empty until a session is
 * chosen; choosing one asks the server for THAT session's students only — the enrolled
 * ones (to remove) and the ones assigned to its teacher and subject (to add).
 * Read only: nothing is enrolled or removed here.
 */
const t = messages.en.management.enrollments;

test("choosing a session loads only that session's students", async ({ open }) => {
  const r = run();
  const page = await open("admin");
  await visit(page, "/en/admin/enrollments");
  await expectHealthyPage(page, "en");
  const [sessionSelect, studentSelect] = [page.locator("select").nth(0), page.locator("select").nth(1)];
  await expect(studentSelect).toBeDisabled();
  await expect(studentSelect.locator("option")).toHaveCount(1);
  await expect(page.getByRole("button", { name: t.enroll })).toBeDisabled();

  const loaded = page.waitForResponse((response) => response.url().includes(`/api/admin/enrollments?sessionId=${r.ids.futureSession}`) && response.request().method() === "GET");
  await sessionSelect.selectOption(r.ids.futureSession);
  expect((await loaded).status()).toBe(200);
  await expect(studentSelect).toBeEnabled();

  const enrolled = studentSelect.locator(`optgroup[label="${t.enrolledGroup}"] option`);
  const available = studentSelect.locator(`optgroup[label="${t.availableGroup}"] option`);
  await expect(enrolled).toHaveText(["Demo Test student2"]);
  await expect(available).toContainText(["Demo Test student1"]);
  // Another teacher's student and an unassigned student are never offered.
  await expect(studentSelect.locator("option", { hasText: /^Demo Test student9$/ })).toHaveCount(0);
  await expect(studentSelect.locator("option", { hasText: /^Demo Test student10$/ })).toHaveCount(0);

  // Enroll is for the available group only; Remove for the enrolled one.
  await studentSelect.selectOption({ label: "Demo Test student2" });
  await expect(page.getByRole("button", { name: t.enroll })).toBeDisabled();
  await expect(page.getByRole("button", { name: t.remove })).toBeEnabled();
  await studentSelect.selectOption({ label: "Demo Test student1" });
  await expect(page.getByRole("button", { name: t.enroll })).toBeEnabled();
  await expect(page.getByRole("button", { name: t.remove })).toBeDisabled();
});
