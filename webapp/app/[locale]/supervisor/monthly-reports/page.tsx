import MonthlyReportsAdminPage from "../../../_components/monthly/monthly-reports-admin-page";

export default async function SupervisorMonthlyReportsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  return MonthlyReportsAdminPage({ role: "SUPERVISOR", searchParams });
}
