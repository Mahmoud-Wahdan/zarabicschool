import { getLocale, getTranslations } from "next-intl/server";

import Icon from "../ui/icon";

export default async function HowToStart() {
  const locale = await getLocale();
  const t = await getTranslations("landing.steps");
  const numeral = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB");

  const steps = [
    {
      n: 1,
      circle: "bg-primary text-on-primary",
      title: t("s1title"),
      text: t("s1text"),
      foot: t("s1foot"),
      footIcon: "hourglass_empty",
    },
    {
      n: 2,
      circle: "bg-secondary text-on-secondary",
      title: t("s2title"),
      text: t("s2text"),
      foot: t("s2foot"),
      footIcon: "tune",
    },
    {
      n: 3,
      circle: "bg-primary text-on-primary",
      title: t("s3title"),
      text: t("s3text"),
      foot: t("s3foot"),
      footIcon: "videocam",
    },
    {
      n: 4,
      circle: "bg-tertiary-container text-on-tertiary-container",
      title: t("s4title"),
      text: t("s4text"),
      foot: t("s4foot"),
      footIcon: "task_alt",
    },
  ] as const;

  return (
    <section className="section-anchor w-full bg-surface py-14 md:py-20" id="steps">
      <div className="mx-auto max-w-7xl space-y-8 px-[clamp(1.25rem,4vw,2.5rem)]">
        <div className="max-w-3xl space-y-3">
          <h2 className="text-balance text-headline-lg-mobile font-bold text-primary md:text-headline-lg">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <ol className="grid gap-x-7 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li key={step.n} className="space-y-3 border-t border-outline-variant pt-5">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-bold ${step.circle}`}
              >
                {numeral.format(step.n)}
              </div>
              <h3 className="text-title-md font-bold text-primary">{step.title}</h3>
              <p className="text-body-sm text-on-surface-variant">{step.text}</p>
              <div className="flex items-start gap-2 pt-2 text-label-sm font-semibold text-secondary">
                <Icon name={step.footIcon} size={16} className="mt-0.5 shrink-0" />
                <span>{step.foot}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
