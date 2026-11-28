import { getTranslations } from "next-intl/server";

import LegalPage from "../../_components/legal/legal-page";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: `${t("about.title")} | Zarabicschool` };
}

export default function AboutPage() {
  return <LegalPage kind="about" />;
}
