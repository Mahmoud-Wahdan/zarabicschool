"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";

export default function FaqAccordion() {
  const t = useTranslations("faq");
  const items = t.raw("items") as { q: string; a: string }[];
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <section id="faq" className="section-anchor bg-[var(--surface)]">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold text-[var(--navy)] sm:text-3xl">{t("title")}</h2>
        <div className="mt-10 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--background)]">
          {items.map((item, index) => {
            const panelId = `${baseId}-panel-${index}`;
            const buttonId = `${baseId}-button-${index}`;
            const open = openIndex === index;
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    id={buttonId}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start text-base font-semibold text-[var(--navy)]"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(open ? null : index)}
                  >
                    <span>{item.q}</span>
                    <span aria-hidden className="text-[var(--gold)]">
                      {open ? "−" : "+"}
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!open}
                  className="px-5 pb-4 text-sm leading-relaxed text-[var(--foreground)]/80"
                >
                  {item.a}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
