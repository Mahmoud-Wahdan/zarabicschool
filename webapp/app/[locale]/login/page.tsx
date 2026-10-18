import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import LocaleSwitcher from "../../_components/locale-switcher";
import LogoPlaceholder from "../../_components/logo-placeholder";
import { getAuthSession } from "../../../lib/dal";
import LoginForm from "./login-form";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function LoginPage() {
  const user = await getAuthSession();
  if (user) {
    const locale = await getLocale();
    redirect(
      user.mustChangePassword ? `/${locale}/change-password` : `/${locale}/${user.role.toLowerCase()}`,
    );
  }

  const t = await getTranslations("login");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-surface p-4 md:p-6">
      <div className="flex w-full max-w-lg items-center justify-between px-2 pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-secondary" aria-hidden="true" />
          <span className="text-label-sm tracking-wide text-secondary">{t("status")}</span>
        </div>
        <LocaleSwitcher className="rounded-full border border-outline-variant px-3 py-1 text-label-sm font-semibold text-on-surface-variant transition-colors hover:text-on-surface" />
      </div>

      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-surface-container-lowest shadow-md transition-all duration-200">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-tertiary-container to-secondary" aria-hidden="true" />
        <div className="flex flex-col p-8 sm:p-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-surface-container-low p-2">
              <LogoPlaceholder size={56} />
            </span>
            <div className="space-y-1">
              <span className="inline-block text-label-sm font-semibold uppercase tracking-wider text-tertiary">
                {t("eyebrow")}
              </span>
              <h1 className="text-headline-sm font-bold tracking-tight text-primary">{t("academyLine")}</h1>
              <p className="text-label-md font-medium text-on-surface-variant">{t("portalLine")}</p>
            </div>
          </div>

          <div className="mb-6 text-center">
            <h2 className="text-title-md font-bold text-primary">{t("title")}</h2>
            <p className="mt-1.5 text-body-sm leading-relaxed text-on-surface-variant">{t("subtitle")}</p>
          </div>

          <LoginForm />

          <div className="mt-8 flex flex-col gap-3 rounded-xl bg-surface-container-low p-4 pt-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg text-tertiary" aria-hidden="true">
                contact_support
              </span>
              <h3 className="text-label-md font-bold text-primary">{t("forgotTitle")}</h3>
            </div>
            <p className="text-body-sm leading-relaxed text-on-surface-variant">{t("forgotText")}</p>
          </div>

          <div className="mt-6 text-center">
            <span className="text-body-sm text-on-surface-variant">{t("noAccount")}</span>{" "}
            <a
              href={`/${locale}/apply`}
              className="text-body-sm font-bold text-primary underline-offset-4 hover:text-secondary hover:underline"
            >
              {tCommon("applyNow")}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
