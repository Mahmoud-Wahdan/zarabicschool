import { getTranslations } from "next-intl/server";

import { buildPublicMetadata } from "../../../lib/seo";
import LegalPage from "../../_components/legal/legal-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  return buildPublicMetadata({
    locale,
    path: "/privacy",
    title: t("privacy.title"),
    description: t("privacy.summary"),
  });
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
