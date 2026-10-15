import ReportsQueuePage from "../../../_components/reports-queue/reports-queue-page";

export const metadata = { title: "تقارير الحصص | Zarabicschool" };

export default async function SupervisorReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsQueuePage role="SUPERVISOR" searchParams={await searchParams} />;
}
