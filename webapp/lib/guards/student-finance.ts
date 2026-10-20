import "server-only";
import { getStudentFinanceProfile } from "../dal";

export async function requireStudentFinanceAccess(userId: string) {
  const student = await getStudentFinanceProfile(userId);
  if (student !== null && student.guardianId !== null) {
    const error = new Error("FINANCE_ACCESS_FORBIDDEN");
    (error as unknown as { status: number }).status = 403;
    throw error;
  }
  return student; // null أو { id, guardianId: null, isAdult }
}