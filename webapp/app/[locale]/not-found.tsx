import { useTranslations } from "next-intl";

import { Link } from "../../i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
      <p className="mt-2 text-sm text-[var(--foreground)] opacity-70">{t("description")}</p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-[var(--emerald)] px-6 py-2.5 font-semibold text-white transition hover:opacity-90"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}
