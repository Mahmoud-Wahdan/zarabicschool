import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";

export default async function ClosingCta() {
  const t = await getTranslations("closing");

  return (
    <section className="bg-[var(--background)]">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-20">
        <h2 className="text-2xl font-bold text-[var(--navy)] sm:text-3xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--foreground)]/80">{t("subtitle")}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href="#apply" className="cta-primary w-full sm:w-auto">
            {t("primaryCta")}
          </a>
          <Link href="/login" className="cta-secondary w-full sm:w-auto">
            {t("secondaryCta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
