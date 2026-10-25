import { getTranslations } from "next-intl/server";

import Icon from "../ui/icon";

export default async function Hero() {
  const t = await getTranslations("landing.hero");
  const tRibbon = await getTranslations("landing.ribbon");

  const ribbonItems = [
    { icon: "group", tone: "text-primary", title: tRibbon("item1Title"), text: tRibbon("item1Text") },
    { icon: "fact_check", tone: "text-secondary", title: tRibbon("item2Title"), text: tRibbon("item2Text") },
    { icon: "notifications_active", tone: "text-tertiary", title: tRibbon("item3Title"), text: tRibbon("item3Text") },
    { icon: "family_restroom", tone: "text-primary-container", title: tRibbon("item4Title"), text: tRibbon("item4Text") },
  ];

  return (
    <section className="section-anchor relative w-full overflow-hidden bg-surface py-12 lg:py-20" id="top">
      <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden="true">
        <div className="absolute -top-24 end-1/4 h-96 w-96 rounded-full bg-secondary-fixed-dim/20 blur-3xl" />
        <div className="absolute start-10 top-1/2 h-80 w-80 rounded-full bg-primary-fixed/30 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1600px] px-4 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col items-start gap-6 lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5 text-label-md text-primary shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-secondary" aria-hidden="true" />
              <span>{t("badge")}</span>
            </div>
            <h1 className="text-display-hero font-bold leading-tight tracking-tight text-primary">
              {t("title")}
            </h1>
            <p className="max-w-2xl text-body-lg leading-relaxed text-on-surface-variant">
              {t("subtitle")}
            </p>
            <div className="flex w-full flex-wrap items-center gap-4 pt-2 sm:w-auto">
              <a
                href="#admissions-form"
                className="inline-flex items-center justify-center gap-2 rounded bg-secondary px-6 py-3.5 text-label-md font-bold text-on-secondary shadow-md transition-all hover:bg-on-secondary-container active:scale-95"
              >
                <Icon name="assignment_turned_in" size={20} />
                <span>{t("ctaPrimary")}</span>
              </a>
              <a
                href="#curriculum-section"
                className="inline-flex items-center justify-center gap-2 rounded bg-surface-container-lowest px-6 py-3.5 text-label-md font-bold text-primary shadow-sm transition-all hover:bg-surface-container-low"
              >
                <Icon name="menu_book" size={20} />
                <span>{t("ctaSecondary")}</span>
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-6 pt-4 text-body-sm text-on-surface-variant">
              <span className="flex items-center gap-2">
                <Icon name="verified" size={18} className="text-secondary" />
                <span>{t("meta1")}</span>
              </span>
              <span className="flex items-center gap-2">
                <Icon name="schedule" size={18} className="text-secondary" />
                <span>{t("meta2")}</span>
              </span>
            </div>
          </div>

          <div className="w-full lg:col-span-5">
            <div className="space-y-5 overflow-hidden rounded-xl bg-surface-container-lowest p-6 shadow-[var(--elev-3)]">
              <div className="-mx-6 -mt-6 flex items-center justify-between bg-surface-container-low p-4 px-6 pb-4">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
                    أم
                    <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-secondary ring-2 ring-surface-container-lowest" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="text-title-md font-bold text-primary">{t("card.teacherName")}</span>
                      <span className="rounded bg-tertiary-fixed px-1.5 py-0.5 text-[10px] font-semibold text-on-tertiary-fixed">
                        {t("card.teacherBadge")}
                      </span>
                    </span>
                    <span className="text-label-sm text-on-surface-variant">{t("card.teacherRole")}</span>
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded bg-secondary-container/40 px-2.5 py-1 text-label-sm font-semibold text-on-secondary-container">
                  <span className="h-2 w-2 animate-ping rounded-full bg-secondary" aria-hidden="true" />
                  <span>{t("card.liveTag")}</span>
                </span>
              </div>

              <div className="space-y-3 rounded-lg bg-surface-container-low p-4">
                <div className="flex items-center justify-between">
                  <span className="text-label-sm text-on-surface-variant">{t("card.boardLabel")}</span>
                  <span className="text-label-sm font-bold text-secondary">سورة مريم — الآيات (١-٧)</span>
                </div>
                <div className="rounded bg-surface-container-lowest p-4 text-center font-serif text-lg leading-loose text-primary shadow-sm">
                  {t("card.boardText")}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                    <Icon name="mic" size={16} className="text-secondary" />
                    <span>{t("card.capture")}</span>
                  </span>
                  <div className="flex h-4 items-end gap-1" aria-hidden="true">
                    <span className="h-2 w-1 animate-pulse rounded-full bg-secondary" />
                    <span className="h-4 w-1 animate-pulse rounded-full bg-secondary [animation-delay:75ms]" />
                    <span className="h-3 w-1 animate-pulse rounded-full bg-secondary [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-secondary" />
                    <span className="h-4 w-1 animate-pulse rounded-full bg-secondary [animation-delay:100ms]" />
                    <span className="h-2 w-1 rounded-full bg-secondary" />
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded bg-surface-container p-3">
                <Icon name="draw" size={20} className="mt-0.5 shrink-0 text-tertiary" />
                <div className="text-start">
                  <div className="text-label-sm font-bold text-primary">{t("card.annotationTitle")}</div>
                  <div className="text-body-sm text-on-surface-variant">{t("card.annotationText")}</div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  {["videocam", "volume_up", "screen_share"].map((name) => (
                    <span
                      key={name}
                      className="inline-flex h-8 w-8 items-center justify-center rounded bg-surface-container-high text-primary"
                    >
                      <Icon name={name} size={18} />
                    </span>
                  ))}
                </div>
                <span className="font-mono text-label-sm text-outline">{t("card.timer")}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 rounded-xl bg-surface-container-lowest p-6 shadow-[var(--elev-1)]">
          <div className="grid grid-cols-1 gap-6 text-start sm:grid-cols-2 lg:grid-cols-4">
            {ribbonItems.map((item) => (
              <div key={item.icon} className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container">
                  <Icon name={item.icon} size={22} className={item.tone} />
                </span>
                <div>
                  <h3 className="text-title-md font-bold text-primary">{item.title}</h3>
                  <p className="text-body-sm text-on-surface-variant">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
