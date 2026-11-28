import { getTranslations } from "next-intl/server";

import { buildPublicMetadata } from "../../../lib/seo";
import LegalPage from "../../_components/legal/legal-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  return buildPublicMetadata({
    locale,
    path: "/about",
    title: t("about.title"),
    description: t("about.subtitle"),
  });
}

export default function AboutPage() {
  return <LegalPage kind="about" />;
}
