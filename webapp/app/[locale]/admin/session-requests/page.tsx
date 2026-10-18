import { getTranslations } from "next-intl/server";

import SessionRequestsPage from "../../../_components/session-requests/session-requests-page";

export async function generateMetadata() {
  const t = await getTranslations("sessionRequests");
  return { title: `${t("title")} | Zarabicschool` };
}

export default function AdminSessionRequestsPage() {
  return <SessionRequestsPage role="ADMIN" />;
}
