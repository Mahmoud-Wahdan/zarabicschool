import { getTranslations } from "next-intl/server";

import Icon from "../ui/icon";

export default async function WhyUs() {
  const t = await getTranslations("landing.why");

  const liveItems = [
    { lead: t("live1Lead"), text: t("live1Text") },
    { lead: t("live2Lead"), text: t("live2Text") },
    { lead: t("live3Lead"), text: t("live3Text") },
    { lead: t("live4Lead"), text: t("live4Text") },
  ];

  const recordedItems = [
    { lead: t("recorded1Lead"), text: t("recorded1Text") },
    { lead: t("recorded2Lead"), text: t("recorded2Text") },
    { lead: t("recorded3Lead"), text: t("recorded3Text") },
    { lead: t("recorded4Lead"), text: t("recorded4Text") },
  ];

  return (
    <section className="section-anchor w-full bg-surface-container-low py-16" id="about-academy">
      <div className="mx-auto max-w-[1600px] space-y-12 px-4 lg:px-8">
        <div className="max-w-3xl space-y-3 text-start">
          <span className="text-label-md font-bold uppercase text-secondary">{t("eyebrow")}</span>
          <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="z-card space-y-6 rounded-xl border-r-4 border-secondary p-8 rtl:border-r-0 rtl:border-l-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-container/40 text-secondary">
                  <Icon name="live_tv" size={24} />
                </span>
                <div>
                  <h3 className="text-title-md font-bold text-primary">{t("liveTitle")}</h3>
                  <span className="text-label-sm font-semibold text-secondary">{t("liveTag")}</span>
                </div>
              </div>
              <span className="rounded bg-secondary px-2.5 py-1 text-label-sm font-bold text-on-secondary">
                {t("liveBadge")}
              </span>
            </div>
            <ul className="space-y-4">
              {liveItems.map((item) => (
                <li key={item.lead} className="flex items-start gap-3">
                  <Icon name="check_circle" size={20} className="mt-0.5 shrink-0 text-secondary" />
                  <span className="text-body-md text-on-surface">
                    <strong>{item.lead}</strong> {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-6 rounded-xl bg-surface-container p-8 opacity-90 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container-high text-outline">
                <Icon name="videocam_off" size={24} />
              </span>
              <div>
                <h3 className="text-title-md font-bold text-on-surface">{t("recordedTitle")}</h3>
                <span className="text-label-sm font-medium text-on-surface-variant">{t("recordedTag")}</span>
              </div>
            </div>
            <ul className="space-y-4">
              {recordedItems.map((item) => (
                <li key={item.lead} className="flex items-start gap-3">
                  <Icon name="cancel" size={20} className="mt-0.5 shrink-0 text-error" />
                  <span className="text-body-md text-on-surface-variant">
                    <strong>{item.lead}</strong> {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
