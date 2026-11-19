import { getTranslations } from "next-intl/server";

import ApplyRoleCards from "./apply-role-cards";

export default async function ApplyRoles() {
  const t = await getTranslations("landing.admissions");

  return (
    <section className="section-anchor w-full bg-surface-container-low py-14 md:py-20" id="admissions-form">
      <div className="mx-auto max-w-7xl space-y-8 px-[clamp(1.25rem,4vw,2.5rem)]">
        <div className="space-y-3 text-start">
          <h2 className="text-balance text-headline-lg-mobile font-bold text-primary md:text-headline-lg">{t("title")}</h2>
          <p className="max-w-2xl text-body-md leading-relaxed text-on-surface-variant">{t("subtitle")}</p>
        </div>
        <ApplyRoleCards />
      </div>
    </section>
  );
}
