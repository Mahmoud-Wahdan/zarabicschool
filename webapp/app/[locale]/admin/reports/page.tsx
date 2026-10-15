import ReportsQueuePage from "../../../_components/reports-queue/reports-queue-page";

export const metadata = { title: "تقارير الحصص | Zarabicschool" };

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsQueuePage role="ADMIN" searchParams={await searchParams} />;
}
