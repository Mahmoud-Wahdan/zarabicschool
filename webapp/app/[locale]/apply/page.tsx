import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";

const roles = ["guardian", "student", "teacher"] as const;

export default async function ApplyPage({
  searchParams,
}: Pick<PageProps<"/[locale]/apply">, "searchParams">) {
  const { type } = await searchParams;
  const t = await getTranslations("comingSoon");
  const tApply = await getTranslations("apply");

  const role = typeof type === "string" ? roles.find((item) => item === type) : undefined;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-[var(--navy)] sm:text-3xl">{t("title")}</h1>
      {role ? (
        <p className="mt-3 text-sm font-semibold text-[var(--emerald)]">
          {tApply(`${role}.title`)}
        </p>
      ) : null}
      <p className="mt-4 max-w-md text-[var(--foreground)]/80">{t("text")}</p>
      <Link href="/" className="cta-secondary mt-8">
        {t("back")}
      </Link>
    </div>
  );
}
