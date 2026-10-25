import { getTranslations } from "next-intl/server";

import ReportsQueuePage from "../../../_components/reports-queue/reports-queue-page";

export async function generateMetadata() {
  const t = await getTranslations("reportsQueue");
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function SupervisorReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsQueuePage role="SUPERVISOR" searchParams={await searchParams} />;
}
