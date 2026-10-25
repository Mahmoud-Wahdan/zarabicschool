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
      circle: "bg-tertiary-container text-on-tertiary",
      title: t("s4title"),
      text: t("s4text"),
      foot: t("s4foot"),
      footIcon: "task_alt",
    },
  ];

  return (
    <section className="section-anchor w-full bg-surface py-16" id="steps">
      <div className="mx-auto max-w-[1600px] space-y-12 px-4 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <span className="text-label-md font-bold uppercase tracking-wider text-secondary">
            {t("eyebrow")}
          </span>
          <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.n} className="z-card space-y-4 rounded-xl p-6">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full text-base font-bold ${step.circle}`}
              >
                {numeral.format(step.n)}
              </div>
              <h3 className="text-title-md font-bold text-primary">{step.title}</h3>
              <p className="text-body-sm text-on-surface-variant">{step.text}</p>
              <div className="flex items-center gap-1 pt-2 text-label-sm font-semibold text-secondary">
                <Icon name={step.footIcon} size={16} />
                <span>{step.foot}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
