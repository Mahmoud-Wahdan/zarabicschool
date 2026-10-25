import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { getAuthSession } from "../../../lib/dal";
import ChangePasswordForm from "./change-password-form";

export async function generateMetadata() {
  const t = await getTranslations("changePassword");
  return { title: `${t("title")} | Zarabicschool` };
}

export default async function ChangePasswordPage() {
  const user = await getAuthSession();
  const locale = await getLocale();
  const t = await getTranslations("changePassword");
  if (!user) redirect(`/${locale}/login`);
  if (!user.mustChangePassword) redirect(`/${locale}/${user.role.toLowerCase()}`);

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-surface p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-xl flex-col py-2 sm:py-4">
        <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest shadow-xl">
          <div className="h-1.5 w-full bg-surface-container" aria-hidden="true">
            <div className="h-full bg-secondary" style={{ width: "35%" }} aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-container text-headline-sm text-on-primary shadow-sm select-none">
                  Z
                </span>
                <span className="flex flex-col">
                  <span className="text-headline-sm tracking-tight text-primary">Zarabicschool</span>
                  <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                    Academic Portal
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-surface-container-low px-3 py-1 text-secondary">
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                  aria-hidden="true"
                >
                  verified_user
                </span>
                <span className="text-label-sm font-semibold">{t("secureBadge")}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-primary">
                <span className="material-symbols-outlined text-headline-md text-secondary" aria-hidden="true">
                  lock_reset
                </span>
                <h1 className="text-headline-md font-bold">{t("title")}</h1>
              </div>
              <p className="text-body-sm text-on-surface-variant">{t("subtitle")}</p>
            </div>

            <div className="flex items-start gap-3.5 rounded-lg bg-surface-container-low p-4">
              <span
                className="material-symbols-outlined mt-0.5 shrink-0 text-[22px] text-secondary"
                style={{ fontVariationSettings: "'FILL' 1" }}
                aria-hidden="true"
              >
                info
              </span>
              <p className="text-body-sm leading-relaxed text-on-surface">{t("infoText")}</p>
            </div>

            <ChangePasswordForm username={user.username} role={user.role} />
          </div>
        </div>
      </div>
    </main>
  );
}
