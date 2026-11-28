import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import LocaleSwitcher from "../../_components/locale-switcher";
import LogoPlaceholder from "../../_components/logo-placeholder";
import ThemeSwitch from "../../_components/theme-switch";
import { safeCallbackPath } from "../../../lib/auth/callback-url";
import { getAuthSession } from "../../../lib/dal";
import LoginForm from "./login-form";
import Icon from "../../_components/ui/icon";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  // I-1 / D4: return to the join link (or page) that sent the reader here — allowlisted paths only.
  const callbackPath = safeCallbackPath((await searchParams).callbackUrl);
  const user = await getAuthSession();
  if (user) {
    const locale = await getLocale();
    redirect(
      user.mustChangePassword ? `/${locale}/change-password` : callbackPath ?? `/${locale}/${user.role.toLowerCase()}`,
    );
  }

  const t = await getTranslations("login");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-surface p-4 md:p-6">
      <div className="flex w-full max-w-md justify-end pb-3">
        <div className="flex items-center gap-2">
          <ThemeSwitch className="inline-flex min-h-10 items-center rounded-lg border border-outline-variant px-3 py-1 text-label-sm font-semibold text-on-surface-variant transition-colors hover:text-on-surface" />
          <LocaleSwitcher className="inline-flex min-h-10 items-center rounded-lg border border-outline-variant px-3 py-1 text-label-sm font-semibold text-on-surface-variant transition-colors hover:text-on-surface" />
        </div>
      </div>

      <div className="z-card w-full max-w-md rounded-xl p-5 sm:p-8">
          <div className="mb-6 flex items-center gap-4">
            <span className="block h-12 w-12 shrink-0"><LogoPlaceholder size={48} /></span>
            <div>
              <p className="text-body-sm text-on-surface-variant">{t("academyLine")}</p>
              <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
            </div>
          </div>
          <LoginForm callbackPath={callbackPath} />

          <div className="mt-6 flex flex-col gap-1 border-t border-outline-variant pt-4">
            <div className="flex items-center gap-2">
              <Icon name={"contact_support"} size={18} className="text-tertiary" />
              <h2 className="text-label-md font-bold text-primary">{t("forgotTitle")}</h2>
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
    </main>
  );
}
