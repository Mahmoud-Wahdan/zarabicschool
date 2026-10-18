import { getTranslations } from "next-intl/server";

import ReportsQueuePage from "../../../_components/reports-queue/reports-queue-page";

export async function generateMetadata() {
  const t = await getTranslations("reportsQueue");
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReportsQueuePage role="ADMIN" searchParams={await searchParams} />;
}
