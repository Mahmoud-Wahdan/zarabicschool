import { getTranslations } from "next-intl/server";

import { buildPublicMetadata } from "../../../lib/seo";
import LegalPage from "../../_components/legal/legal-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  return buildPublicMetadata({
    locale,
    path: "/terms",
    title: t("terms.title"),
    description: t("terms.subtitle"),
  });
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
