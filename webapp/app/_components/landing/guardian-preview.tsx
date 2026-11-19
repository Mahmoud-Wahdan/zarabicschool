import { getTranslations } from "next-intl/server";

import Icon from "../ui/icon";

export default async function GuardianPreview() {
  const t = await getTranslations("landing.guardian");

  const features = [
    { icon: "family_restroom", tone: "text-primary", title: t("f1title"), text: t("f1text") },
    { icon: "history_edu", tone: "text-secondary", title: t("f2title"), text: t("f2text") },
    { icon: "chat", tone: "text-tertiary", title: t("f3title"), text: t("f3text") },
  ] as const;

  const stats = [
    { label: t("mockStat1"), value: t("mockStat1Value"), foot: t("mockStat1Foot"), footTone: "text-secondary" },
    { label: t("mockStat2"), value: t("mockStat2Value"), foot: t("mockStat2Foot"), footTone: "text-tertiary" },
    { label: t("mockStat3"), value: t("mockStat3Value"), foot: t("mockStat3Foot"), footTone: "text-secondary" },
  ];

  return (
    <section className="section-anchor w-full bg-surface py-14 md:py-20">
      <div className="mx-auto max-w-7xl px-[clamp(1.25rem,4vw,2.5rem)]">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
          <div className="space-y-6 text-start lg:col-span-5">
            <h2 className="text-balance text-headline-lg-mobile font-bold text-primary md:text-headline-lg">{t("title")}</h2>
            <p className="text-body-md leading-relaxed text-on-surface-variant">{t("subtitle")}</p>
            <div className="space-y-4 pt-2">
              {features.map((feature) => (
                <div key={feature.icon} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container">
                    <Icon name={feature.icon} size={18} className={feature.tone} />
                  </span>
                  <div>
                    <h3 className="text-title-md font-bold text-primary">{feature.title}</h3>
                    <p className="text-body-sm text-on-surface-variant">{feature.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 space-y-6 overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest p-4 shadow-[var(--elev-2)] sm:p-7 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/55 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label-sm text-on-surface-variant">{t("mockChildLabel")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-primary px-3 py-1.5 text-label-md font-bold text-on-primary">
                    {t("mockChild1")}
                  </span>
                  <span className="rounded-lg bg-surface-container px-3 py-1.5 text-label-md text-on-surface">
                    {t("mockChild2")}
                  </span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-label-sm font-semibold text-secondary">
                <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
                <span>{t("mockStatus")}</span>
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="min-w-0 space-y-1 text-start">
                  <span className="text-label-sm text-on-surface-variant">{stat.label}</span>
                  <div className="text-headline-md font-bold text-primary">{stat.value}</div>
                  <span className={`text-label-sm ${stat.footTone}`}>{stat.foot}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-xl bg-surface-container-low p-4 sm:p-5 text-start">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon name="assignment" size={20} className="text-secondary" />
                  <span className="text-title-md font-bold text-primary">{t("mockReportTitle")}</span>
                </div>
                <span className="text-label-sm tabular-nums text-on-surface-variant">{t("mockReportDate")}</span>
              </div>
              <div className="space-y-2 text-body-sm text-on-surface">
                <p>{t("mockReportBody")}</p>
                <p>{t("mockReportNote")}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <span className="text-label-sm font-semibold text-primary">{t("mockReportTeacher")}</span>
                  <span className="inline-flex items-center gap-1 rounded bg-surface-container-lowest px-2 py-0.5 text-label-sm font-bold text-secondary">
                    <Icon name="check" size={14} />
                    {t("mockReportApproved")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
