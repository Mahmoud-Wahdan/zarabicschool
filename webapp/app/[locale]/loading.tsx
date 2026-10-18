import { getTranslations } from "next-intl/server";

export default async function LocaleLoading() {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="flex flex-col items-center gap-4" role="status">
        <span className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--line)] border-t-[var(--emerald)]" aria-hidden />
        <span className="text-sm text-[var(--foreground)] opacity-60">{t("loading")}</span>
      </div>
    </div>
  );
}
