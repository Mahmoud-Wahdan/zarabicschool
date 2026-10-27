import "server-only";

import { prisma } from "../prisma";

/**
 * Dashboard flag counts (owner 2026-10-27, review #5 option a). The red-mark tile
 * counts LATE session-report flags only, matching the reports queue it links to;
 * missing monthly reports (MONTHLY_REPORT_MISSING) are a separate count that points
 * to the monthly-reports page.
 */
export async function getTeacherFlagCounts(academyId: string): Promise<{ lateReports: number; missingMonthly: number }> {
  const [lateReports, missingMonthly] = await Promise.all([
    prisma.teacherFlag.count({ where: { academyId, flagType: "LATE_REPORT" } }),
    prisma.teacherFlag.count({ where: { academyId, flagType: "MONTHLY_REPORT_MISSING" } }),
  ]);
  return { lateReports, missingMonthly };
}
