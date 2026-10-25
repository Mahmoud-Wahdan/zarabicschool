import MonthlyReportsAdminPage from "../../../_components/monthly/monthly-reports-admin-page";

export default async function AdminMonthlyReportsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  return MonthlyReportsAdminPage({ role: "ADMIN", searchParams });
}
