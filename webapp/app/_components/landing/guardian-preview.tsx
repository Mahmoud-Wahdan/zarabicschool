import { getTranslations } from "next-intl/server";

import Icon from "../ui/icon";

export default async function GuardianPreview() {
  const t = await getTranslations("landing.guardian");

  const features = [
    { icon: "family_restroom", tone: "text-primary", title: t("f1title"), text: t("f1text") },
    { icon: "history_edu", tone: "text-secondary", title: t("f2title"), text: t("f2text") },
    { icon: "chat", tone: "text-tertiary", title: t("f3title"), text: t("f3text") },
  ];

  const stats = [
    { label: t("mockStat1"), value: t("mockStat1Value"), foot: t("mockStat1Foot"), footTone: "text-secondary" },
    { label: t("mockStat2"), value: t("mockStat2Value"), foot: t("mockStat2Foot"), footTone: "text-tertiary" },
    { label: t("mockStat3"), value: t("mockStat3Value"), foot: t("mockStat3Foot"), footTone: "text-secondary" },
  ];

  return (
    <section className="section-anchor w-full bg-surface py-16">
      <div className="mx-auto max-w-[1600px] px-4 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
          <div className="space-y-6 text-start lg:col-span-5">
            <div className="inline-flex items-center gap-2 text-label-md font-bold text-secondary">
              <Icon name="dashboard" size={18} />
              <span>{t("eyebrow")}</span>
            </div>
            <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
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

          <div className="space-y-6 rounded-xl bg-surface-container-lowest p-6 shadow-[var(--elev-2)] lg:col-span-7">
            <div className="flex items-center justify-between border-b border-surface-container pb-4">
              <div className="flex items-center gap-2">
                <span className="text-label-sm text-on-surface-variant">{t("mockChildLabel")}</span>
                <div className="flex items-center gap-2">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="space-y-1 rounded-lg bg-surface-container-low p-4 text-start">
                  <span className="text-label-sm text-on-surface-variant">{stat.label}</span>
                  <div className="text-headline-md font-bold text-primary">{stat.value}</div>
                  <span className={`text-label-sm ${stat.footTone}`}>{stat.foot}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-lg bg-surface-container p-4 text-start">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon name="assignment" size={20} className="text-secondary" />
                  <span className="text-title-md font-bold text-primary">{t("mockReportTitle")}</span>
                </div>
                <span className="font-mono text-label-sm text-outline">{t("mockReportDate")}</span>
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
