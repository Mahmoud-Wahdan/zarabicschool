import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { siteConfig } from "../../../lib/site-config";
import Icon from "../ui/icon";
import styles from "./hero.module.css";

export default async function Hero({ whatsappHref }: { whatsappHref: string | null }) {
  const t = await getTranslations("landing.hero");
  const tRibbon = await getTranslations("landing.ribbon");
  const tFooter = await getTranslations("landing.footer");

  const ribbonItems = [
    { icon: "group", tone: "text-primary", title: tRibbon("item1Title"), text: tRibbon("item1Text") },
    { icon: "fact_check", tone: "text-secondary", title: tRibbon("item2Title"), text: tRibbon("item2Text") },
    { icon: "notifications_active", tone: "text-tertiary", title: tRibbon("item3Title"), text: tRibbon("item3Text") },
    { icon: "family_restroom", tone: "text-primary", title: tRibbon("item4Title"), text: tRibbon("item4Text") },
  ] as const;

  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.inner}>
          <div className={styles.copy}>
            <p className={styles.status}>{t("badge")}</p>
            <h1 id="hero-heading" className={styles.title}>
              {t("headlineFirst")}{" "}
              <span>{t("headlineSecond")}</span>
            </h1>
            <p className={styles.subtitle}>{t("subtitle")}</p>
            <div className={styles.actions}>
              <a href="#admissions-form" className={styles.primary}>
                <Icon name="assignment_turned_in" size={19} />{t("ctaPrimary")}
              </a>
              {whatsappHref && (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={styles.secondary}>
                  <Icon name="chat" size={19} />{tFooter("whatsappCta")}
                </a>
              )}
              <a href="#curriculum-section" className={whatsappHref ? styles.curriculum : styles.secondary}>
                <Icon name="menu_book" size={19} />{t("ctaSecondary")}
              </a>
            </div>
            <div className={styles.meta}>
              <span><Icon name="verified" size={17} />{t("meta1")}</span>
              <span><Icon name="schedule" size={17} />{t("meta2")}</span>
            </div>
          </div>
          <div className={styles.brand}>
            <Image src={siteConfig.logo.variations.reversed} alt={siteConfig.brandName} width={491} height={484} sizes="(max-width: 760px) 100px, (max-width: 1200px) 25vw, 340px" loading="eager" className={styles.lockup} />
          </div>
        </div>
      </section>
      <section aria-label={t("lessonHeading")} className={styles.preview}>
        <details className={styles.disclosure}>
          <summary className={styles.lessonSummary}>
            <Icon name="videocam" size={20} />
            <span>{t("lessonHeading")}</span>
            <Icon name="expand_more" size={20} className={styles.chevron} />
          </summary>
          <div className={styles.previewInner}>
          <div className={styles.lesson}>
            <div className="space-y-4 overflow-hidden rounded-xl border border-[var(--hairline)] bg-surface-container-lowest p-6">
              <div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-2 bg-surface-container-low px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
                    {t("card.initials")}
                    <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-secondary ring-2 ring-surface-container-lowest" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-title-md font-bold text-primary">{t("card.teacherName")}</span>
                      <span className="rounded bg-tertiary-fixed px-1.5 py-0.5 text-[10px] font-semibold text-on-tertiary-fixed">
                        {t("card.teacherBadge")}
                      </span>
                    </span>
                    <span className="text-label-sm text-on-surface-variant">{t("card.teacherRole")}</span>
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded bg-secondary-container/40 px-2.5 py-1 text-label-sm font-semibold text-on-secondary-container">
                  <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
                  <span>{t("card.liveTag")}</span>
                </span>
              </div>

              <div className="space-y-3 rounded-lg bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <span className="text-label-sm text-on-surface-variant">{t("card.boardLabel")}</span>
                  <span className="text-label-sm font-bold text-secondary">{t("card.passage")}</span>
                </div>
                <div lang="ar" dir="rtl" className="rounded bg-surface-container-lowest p-4 text-center font-serif text-lg leading-loose text-primary shadow-sm">
                  {t("card.boardText")}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
                    <Icon name="mic" size={16} className="text-secondary" />
                    <span>{t("card.capture")}</span>
                  </span>
                  <div className="flex h-4 items-end gap-1" aria-hidden="true">
                    <span className="h-2 w-1 rounded-full bg-secondary" />
                    <span className="h-4 w-1 rounded-full bg-secondary" />
                    <span className="h-3 w-1 rounded-full bg-secondary" />
                    <span className="h-1 w-1 rounded-full bg-secondary" />
                    <span className="h-4 w-1 rounded-full bg-secondary" />
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
                  {(["videocam", "volume_up", "screen_share"] as const).map((name) => (
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
          <div className={styles.ribbon}>
            <h2 className={styles.ribbonHeading}>{t("title")}</h2>
            {ribbonItems.map((item) => (
              <div key={item.icon} className={styles.ribbonItem}>
                <Icon name={item.icon} size={26} className={item.tone} />
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
          </div>
        </details>
      </section>
    </>
  );
}
