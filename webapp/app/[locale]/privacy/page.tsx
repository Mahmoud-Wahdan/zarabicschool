import { getTranslations } from "next-intl/server";

import LegalPage from "../../_components/legal/legal-page";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: `${t("privacy.title")} | Zarabicschool` };
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
