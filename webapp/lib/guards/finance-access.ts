/**
 * The ONE finance-wall rule (B5 / S6 — CONTEXT §12, owner 2026-10-18): a student
 * WITH a guardian has no finance access at all; the guardian pays. A student pays
 * for himself only when ADULT and without a guardian. Pure functions (no I/O) so
 * routes, pages and the DAL share exactly the same decision.
 */

export type FinanceStudent = {
  userId: string;
  guardianId: string | null;
  isAdult: boolean;
  guardian?: { userId: string } | null;
};

/** The student is their own payer (adult, no guardian). */
export function studentPaysForSelf(student: { guardianId: string | null; isAdult: boolean }): boolean {
  return student.guardianId === null && student.isAdult;
}

/**
 * May this user act on this student's invoices? ADMIN (when allowed for the action),
 * the linked guardian, or the student himself when he pays for himself.
 */
export function canActOnStudentFinance(
  user: { id: string; role: string },
  student: FinanceStudent,
  options: { allowAdmin: boolean } = { allowAdmin: true },
): boolean {
  if (user.role === "ADMIN") return options.allowAdmin;
  if (user.role === "GUARDIAN") return student.guardian?.userId === user.id;
  if (user.role === "STUDENT") return student.userId === user.id && studentPaysForSelf(student);
  return false;
}
