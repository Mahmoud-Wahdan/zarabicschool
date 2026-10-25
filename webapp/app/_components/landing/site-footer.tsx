import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import Icon from "../ui/icon";

export default async function SiteFooter() {
  const t = await getTranslations("landing.footer");
  const tBrand = await getTranslations("brand");
  const tNav = await getTranslations("landing.nav");
  const tCommon = await getTranslations("common");
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 w-full bg-surface-container-lowest shadow-[0_-1px_12px_rgba(27,54,93,0.04)]">
      <div className="mx-auto max-w-[1600px] px-4 pb-6 pt-10 lg:px-8">
        <div className="grid grid-cols-1 gap-10 pb-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-tertiary-fixed shadow-[0_2px_4px_rgba(0,32,70,0.14)]">
                <Icon name="mosque" size={22} />
              </span>
              <span className="flex flex-col">
                <span className="text-headline-sm font-bold text-primary">{tBrand("name")}</span>
                <span className="text-label-sm font-medium text-on-surface-variant">{t("subBrand")}</span>
              </span>
            </div>
            <p className="max-w-md text-body-md leading-relaxed text-on-surface-variant">{t("tagline")}</p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-label-sm text-on-surface">
                <Icon name="payments" size={16} className="text-secondary" />
                {t("chip1")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-label-sm text-on-surface">
                <Icon name="verified_user" size={16} className="text-secondary" />
                {t("chip2")}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-title-md font-bold text-primary">{t("colCurriculum")}</h3>
            <ul className="space-y-2">
              <li>
                <a href="#curriculum-section" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">
                  {tNav("curriculum")}
                </a>
              </li>
              <li>
                <a href="#pricing-plans" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">
                  {tNav("pricing")}
                </a>
              </li>
              <li>
                <a href="#about-academy" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">
                  {tNav("about")}
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-title-md font-bold text-primary">{t("colAdmissions")}</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/apply" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">
                  {tNav("admissions")}
                </Link>
              </li>
              <li>
                <Link href="/login" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">
                  {tCommon("login")}
                </Link>
              </li>
              <li>
                <a href="#faq" className="text-body-sm text-on-surface-variant transition-colors hover:text-secondary">
                  {t("standards")}
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-title-md font-bold text-primary">{t("colSupport")}</h3>
            <div className="space-y-3">
              <div className="rounded-lg bg-surface-container-low p-3">
                <div className="flex items-center gap-2 text-label-md font-bold text-primary">
                  <Icon name="videocam" size={18} className="text-secondary" />
                  {t("zoomTitle")}
                </div>
                <p className="mt-1 text-label-sm text-on-surface-variant">{t("zoomText")}</p>
              </div>
              <div className="rounded-lg bg-surface-container-low p-3">
                <div className="flex items-center gap-2 text-label-md font-bold text-primary">
                  <Icon name="chat" size={18} className="text-secondary" />
                  {t("whatsappTitle")}
                </div>
                <p className="mt-1 text-label-sm text-on-surface-variant">{t("whatsappText")}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-surface-container pt-6 text-center md:flex-row md:text-start">
          <div className="flex flex-wrap items-center justify-center gap-4 text-label-sm text-on-surface-variant md:justify-start">
            <span className="font-semibold text-primary">
              © {year} Zarabicschool. {t("rights")}
            </span>
            <span>{t("privacy")}</span>
            <span>{t("terms")}</span>
          </div>
          <div className="flex items-center gap-3 text-label-sm text-on-surface-variant">
            <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
            <span>{t("statusLine")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
