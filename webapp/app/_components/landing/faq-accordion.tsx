"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import Icon from "../ui/icon";

export default function FaqAccordion() {
  const t = useTranslations("landing.faq");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const items = [
    { q: t("q1"), a: t("a1") },
    { q: t("q2"), a: t("a2") },
    { q: t("q3"), a: t("a3") },
    { q: t("q4"), a: t("a4") },
    { q: t("q5"), a: t("a5") },
  ];

  return (
    <section className="section-anchor w-full bg-surface py-16" id="faq">
      <div className="mx-auto max-w-[1200px] space-y-12 px-4 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <span className="text-label-md font-bold uppercase text-secondary">{t("eyebrow")}</span>
          <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <div className="space-y-4">
          {items.map((item, index) => {
            const open = openIndex === index;
            const panelId = `faq-panel-${index}`;
            return (
              <div key={item.q} className="z-card overflow-hidden rounded-xl">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(open ? null : index)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-start text-title-md font-bold text-primary transition-colors hover:bg-surface-container-low"
                >
                  <span>{item.q}</span>
                  <Icon
                    name="expand_more"
                    size={20}
                    className={`shrink-0 text-outline transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open ? (
                  <div id={panelId} className="px-5 pb-5 pt-1 text-body-md leading-relaxed text-on-surface-variant">
                    {item.a}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
