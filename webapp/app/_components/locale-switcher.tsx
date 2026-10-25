"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "../../i18n/navigation";
import { routing, type AppLocale } from "../../i18n/routing";

export default function LocaleSwitcher({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("common");
  const nextLocale = (locale === "ar" ? "en" : "ar") as AppLocale;

  return (
    <Link
      href={pathname}
      locale={nextLocale}
      className={`rounded-xl border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--navy)] transition hover:border-[var(--emerald)] hover:text-[var(--emerald)] ${className}`}
      hrefLang={nextLocale}
      lang={nextLocale}
    >
      {t("langSwitch")}
    </Link>
  );
}

export { routing };
