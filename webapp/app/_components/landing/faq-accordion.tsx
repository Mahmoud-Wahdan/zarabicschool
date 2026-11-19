"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

import Icon from "../ui/icon";

export default function FaqAccordion() {
  const t = useTranslations("landing.faq");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const id = useId();
  const entries = [1, 2, 3, 4, 5] as const;

  return (
    <section className="section-anchor w-full bg-surface py-14 md:py-20" id="faq" aria-labelledby={id}>
      <div className="mx-auto grid max-w-7xl gap-8 px-[clamp(1.25rem,4vw,2.5rem)] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
        <div className="max-w-2xl space-y-3 text-start">
          <h2 id={id} className="text-balance text-headline-lg-mobile font-bold text-primary md:text-headline-lg">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>
        <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {entries.map((entry) => {
            const open = openIndex === entry;
            const panelId = `${id}-answer-${entry}`;
            return (
              <div key={entry}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(open ? null : entry)}
                    className="flex w-full items-center justify-between gap-4 rounded-sm py-5 text-start text-title-md font-bold text-primary hover:text-secondary"
                  >
                    <span>{t(`q${entry}`)}</span>
                    <Icon name="expand_more" size={20} className={`shrink-0 text-secondary motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                </h3>
                <p id={panelId} hidden={!open} className="max-w-[72ch] pb-5 pe-6 text-body-md leading-relaxed text-on-surface-variant">
                  {t(`a${entry}`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
