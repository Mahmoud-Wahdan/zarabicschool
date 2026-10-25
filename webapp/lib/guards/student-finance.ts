import "server-only";

import { prisma } from "../prisma";
import { studentFinanceBlocked } from "../dal";

/**
 * Checks if a student profile has a linked guardian.
 */
export async function hasGuardianLinked(studentId: string): Promise<boolean> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { guardianId: true },
  });
  return student !== null && student.guardianId !== null;
}

/**
 * Server-side finance wall guard (CONTEXT §12/§21.6):
 * Throws 403 Forbidden error if a student has a linked guardian.
 * Adult students without a guardian are permitted.
 */
export async function requireStudentFinanceAccess(userId: string): Promise<void> {
  const blocked = await studentFinanceBlocked(userId);
  if (blocked) {
    const error = new Error("FINANCE_ACCESS_FORBIDDEN");
    (error as unknown as { status: number }).status = 403;
    throw error;
  }
}