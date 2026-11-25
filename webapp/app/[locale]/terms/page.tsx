import { getTranslations } from "next-intl/server";

import LegalPage from "../../_components/legal/legal-page";

export async function generateMetadata() {
  const t = await getTranslations("legal");
  return { title: `${t("terms.title")} | Zarabicschool` };
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
