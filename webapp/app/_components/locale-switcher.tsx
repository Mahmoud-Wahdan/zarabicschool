"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "../../i18n/navigation";
import { routing } from "../../i18n/routing";

export default function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("localeSwitcher");

  return (
    <nav aria-label={t("label")} className="flex items-center gap-1 text-xs">
      {routing.locales.map((item) => (
        <Link
          key={item}
          href={pathname}
          locale={item}
          className={`rounded-lg border px-2 py-1 transition ${
            item === locale
              ? "border-[var(--emerald)] font-semibold text-[var(--emerald)]"
              : "border-[var(--line)] text-[var(--foreground)] opacity-70 hover:border-[var(--emerald)] hover:text-[var(--emerald)]"
          }`}
        >
          {t(item)}
        </Link>
      ))}
    </nav>
  );
}
