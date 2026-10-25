import { getTranslations } from "next-intl/server";

import Icon from "../ui/icon";

export default async function PricingPlans() {
  const t = await getTranslations("landing.pricing");

  const bulletsFor = (plan: 1 | 2 | 3): { icon?: string; text: string }[] => {
    if (plan === 1) {
      return [
        { text: t("bullet1"), icon: "check" },
        { text: t("bullet2"), icon: "check" },
        { text: t("bullet3"), icon: "check" },
        { text: t("bullet4"), icon: "check" },
      ];
    }
    if (plan === 2) {
      return [
        { text: t("bullet1"), icon: "check" },
        { text: t("bullet2"), icon: "check" },
        { text: t("bullet3"), icon: "check" },
        { text: t("bullet5"), icon: "check" },
      ];
    }
    return [
      { text: t("bullet1"), icon: "check" },
      { text: t("bullet2"), icon: "check" },
      { text: t("bullet6"), icon: "check" },
      { text: t("bullet5"), icon: "check" },
    ];
  };

  const plans = [
    {
      eyebrow: t("plan1Eyebrow"),
      title: t("plan1Title"),
      text: t("plan1Text"),
      payment: t("plan1Payment"),
      sessions: t("plan1Sessions"),
      bullets: bulletsFor(1),
      cta: t("plan1Cta"),
      featured: false,
      boxClass: "bg-surface-container",
      ctaClass:
        "bg-surface-container-high text-primary hover:bg-surface-container-highest",
    },
    {
      eyebrow: t("plan2Eyebrow"),
      title: t("plan2Title"),
      text: t("plan2Text"),
      payment: t("plan2Payment"),
      sessions: t("plan2Sessions"),
      bullets: bulletsFor(2),
      cta: t("plan2Cta"),
      featured: true,
      boxClass: "bg-secondary-container/20",
      ctaClass: "bg-secondary text-on-secondary hover:bg-on-secondary-container shadow-md",
    },
    {
      eyebrow: t("plan3Eyebrow"),
      title: t("plan3Title"),
      text: t("plan3Text"),
      payment: t("plan3Payment"),
      sessions: t("plan3Sessions"),
      bullets: bulletsFor(3),
      cta: t("plan3Cta"),
      featured: false,
      boxClass: "bg-surface-container",
      ctaClass:
        "bg-surface-container-high text-primary hover:bg-surface-container-highest",
    },
  ];

  return (
    <section className="section-anchor w-full bg-surface-container-low py-16" id="pricing-plans">
      <div className="mx-auto max-w-[1600px] space-y-12 px-4 lg:px-8">
        <div className="max-w-3xl space-y-3 text-start">
          <span className="text-label-md font-bold uppercase text-secondary">{t("eyebrow")}</span>
          <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.title}
              className={`relative flex flex-col justify-between gap-6 rounded-xl bg-surface-container-lowest p-8 shadow-sm ${
                plan.featured ? "border-2 border-secondary shadow-lg" : ""
              }`}
            >
              {plan.featured ? (
                <span className="absolute -top-3.5 end-6 rounded-full bg-secondary px-3 py-1 text-label-sm font-bold text-on-secondary shadow-sm">
                  {t("plan2Badge")}
                </span>
              ) : null}
              <div className="space-y-4">
                <div className="space-y-1">
                  <span
                    className={`text-label-sm font-bold ${plan.featured ? "text-secondary" : "text-tertiary"}`}
                  >
                    {plan.eyebrow}
                  </span>
                  <h3 className="text-headline-sm font-bold text-primary">{plan.title}</h3>
                  <p className="text-body-sm text-on-surface-variant">{plan.text}</p>
                </div>
                <div className={`space-y-1 rounded-lg p-4 ${plan.boxClass}`}>
                  <div className="text-label-sm text-on-surface-variant">{t("paymentLabel")}</div>
                  <div className="text-title-md font-bold text-primary">{plan.payment}</div>
                  <span className="text-label-sm text-on-surface-variant">{plan.sessions}</span>
                </div>
                <ul className="space-y-2.5 text-body-sm text-on-surface">
                  {plan.bullets.map((bullet) => (
                    <li key={bullet.text} className="flex items-center gap-2">
                      <Icon name={bullet.icon ?? "check"} size={18} className="shrink-0 text-secondary" />
                      <span>{bullet.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <a
                href="#admissions-form"
                className={`inline-flex w-full items-center justify-center rounded py-3 text-label-md font-bold transition-colors ${plan.ctaClass}`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-3 rounded-lg bg-surface-container-lowest p-4 text-start">
          <Icon name="info" size={20} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-body-sm leading-relaxed text-on-surface-variant">
            <strong>{t("noteLead")}</strong> {t("noteText")}
          </div>
        </div>
      </div>
    </section>
  );
}
