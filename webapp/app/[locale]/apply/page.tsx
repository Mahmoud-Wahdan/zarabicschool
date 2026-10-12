import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import ApplyRoleCards from "../../_components/landing/apply-role-cards";
import SiteHeader from "../../_components/landing/site-header";
import Icon from "../../_components/ui/icon";
import LogoPlaceholder from "../../_components/logo-placeholder";
import { Link } from "../../../i18n/navigation";
import ApplyForm from "./apply-form";

const validRoles = ["guardian", "student", "teacher"] as const;
type ValidRole = (typeof validRoles)[number];

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const locale = await getLocale();

  const role: ValidRole | undefined =
    typeof type === "string" && validRoles.includes(type as ValidRole)
      ? (type as ValidRole)
      : undefined;

  if (!role) {
    const t = await getTranslations("landing.applyPortal");
    const tNav = await getTranslations("landing.nav");

    const roadmap = [
      { n: 1, circle: "bg-primary text-on-primary", step: t("r1Step"), title: t("r1Title"), text: t("r1Text"), foot: t("r1Foot"), footIcon: "done", icon: "edit_note" },
      { n: 2, circle: "bg-primary-container text-on-primary", step: t("r2Step"), title: t("r2Title"), text: t("r2Text"), foot: t("r2Foot"), footIcon: "videocam", icon: "record_voice_over" },
      { n: 3, circle: "bg-secondary text-on-secondary", step: t("r3Step"), title: t("r3Title"), text: t("r3Text"), foot: t("r3Foot"), footIcon: "rule", icon: "event_available" },
      { n: 4, circle: "bg-tertiary text-on-tertiary", step: t("r4Step"), title: t("r4Title"), text: t("r4Text"), foot: t("r4Foot"), footIcon: "auto_awesome", icon: "play_circle" },
    ];
    const numeral = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB");

    return (
      <div className="min-h-screen bg-surface">
        <SiteHeader logo={<LogoPlaceholder size={32} inverted />} />
        <div className="relative w-full overflow-hidden pt-20">
          <div className="pointer-events-none absolute -top-32 end-1/4 h-96 w-96 rounded-full bg-secondary-container/20 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute start-10 top-12 h-80 w-80 rounded-full bg-primary-fixed/30 blur-3xl" aria-hidden="true" />

          <div className="mx-auto max-w-[1600px] px-4 pb-6 pt-6 lg:px-8">
            <nav className="flex items-center gap-2 py-2 text-label-md text-on-surface-variant" aria-label="Breadcrumb">
              <Link href="/" className="flex items-center gap-1 transition-colors hover:text-primary">
                <Icon name="home" size={16} />
                <span>{tNav("home")}</span>
              </Link>
              <span className="font-normal text-outline-variant" aria-hidden="true">
                /
              </span>
              <span className="font-bold text-primary">{t("breadcrumb")}</span>
            </nav>

            <div className="mt-4 grid grid-cols-1 items-end gap-6 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-8">
                <div className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-1 text-label-sm font-semibold text-primary">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-secondary" aria-hidden="true" />
                  <span>{t("badge")}</span>
                </div>
                <h1 className="text-display-hero font-bold leading-snug tracking-tight text-primary">
                  {t("title")}
                </h1>
                <p className="max-w-3xl pt-1 text-body-lg text-on-surface-variant">{t("subtitle")}</p>
              </div>
              <div className="flex lg:col-span-4 lg:justify-end">
                <div className="flex w-full items-center gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-[0_2px_12px_rgba(27,54,93,0.06)] sm:w-auto">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-container text-tertiary-fixed">
                    <Icon name="verified" size={26} />
                  </span>
                  <div className="flex flex-col text-start">
                    <span className="text-title-md font-bold text-primary">{t("guaranteeTitle")}</span>
                    <span className="text-body-sm text-on-surface-variant">{t("guaranteeText")}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="mx-auto max-w-[1600px] px-4 py-8 lg:px-8">
          <div className="flex items-center justify-between gap-4 pb-6">
            <div>
              <span className="text-label-sm font-bold uppercase tracking-wider text-secondary">
                {t("pathsEyebrow")}
              </span>
              <h2 className="mt-0.5 text-headline-md font-bold text-primary">{t("pathsTitle")}</h2>
            </div>
            <div className="hidden items-center gap-2 text-label-sm text-on-surface-variant sm:flex">
              <Icon name="lock" size={18} className="text-secondary" />
              <span>{t("privacyNote")}</span>
            </div>
          </div>
          <ApplyRoleCards />
        </section>

        <section className="mx-auto max-w-[1600px] px-4 py-8 lg:px-8">
          <div className="mx-auto mb-8 max-w-2xl space-y-2 text-center">
            <span className="text-label-sm font-bold uppercase tracking-wider text-secondary">
              {t("roadmapEyebrow")}
            </span>
            <h2 className="text-headline-lg font-bold text-primary">{t("roadmapTitle")}</h2>
            <p className="text-body-md text-on-surface-variant">{t("roadmapSubtitle")}</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {roadmap.map((step) => (
              <div key={step.n} className="z-card flex flex-col justify-between gap-3 rounded-xl p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full font-mono text-label-md font-bold ${step.circle}`}
                    >
                      {numeral.format(step.n)}
                    </span>
                    <span className="text-label-sm font-medium text-on-surface-variant">{step.step}</span>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-low text-primary">
                    <Icon name={step.icon} size={22} />
                  </span>
                  <h3 className="text-title-md font-bold text-primary">{step.title}</h3>
                  <p className="text-body-sm leading-relaxed text-on-surface-variant">{step.text}</p>
                </div>
                <div className="flex items-center gap-1 pt-2 text-label-sm font-semibold text-secondary">
                  <Icon name={step.footIcon} size={14} />
                  <span>{step.foot}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1600px] px-4 pb-10 lg:px-8">
          <div className="rounded-xl bg-primary-container p-6 text-on-primary shadow-[0_4px_20px_rgba(0,32,70,0.15)] lg:p-8">
            <div className="flex flex-col items-center justify-between gap-6 lg:flex-row">
              <div className="max-w-2xl space-y-2 text-center lg:text-start">
                <div className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-label-sm font-bold text-tertiary-fixed">
                  <Icon name="support_agent" size={14} />
                  <span>{t("helpBadge")}</span>
                </div>
                <h2 className="text-headline-lg font-bold tracking-tight">{t("helpTitle")}</h2>
                <p className="text-body-md leading-relaxed text-on-primary-container">{t("helpText")}</p>
              </div>
              <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                <Link
                  href="/#faq"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-surface-container-lowest px-5 py-3.5 text-label-md font-bold text-primary transition-all hover:bg-surface-container-low sm:w-auto"
                >
                  <Icon name="help_center" size={18} />
                  <span>{t("helpFaq")}</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  let subjects: {
    id: string;
    slug: string;
    nameAr: string;
    nameEn: string;
  }[] = [];

  try {
    subjects = await prisma.subject.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
      },
    });
  } catch {
    subjects = [];
  }

  return (
    <div className="min-h-screen bg-surface">
      <SiteHeader logo={<LogoPlaceholder size={32} inverted />} />
      <div className="pt-20">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <ApplyForm type={role} subjects={subjects} locale={locale} />
        </div>
      </div>
    </div>
  );
}
