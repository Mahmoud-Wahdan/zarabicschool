import { getTranslations } from "next-intl/server";

import ApplyRoleCards from "./apply-role-cards";
import Icon from "../ui/icon";

export default async function ApplyRoles() {
  const t = await getTranslations("landing.admissions");

  return (
    <section className="section-anchor w-full bg-surface-container-low py-16" id="admissions-form">
      <div className="mx-auto max-w-[1600px] px-4 lg:px-8">
        <div className="space-y-8 rounded-2xl bg-surface-container-lowest p-8 shadow-[var(--elev-2)] lg:p-12">
          <div className="space-y-3 text-start">
            <div className="inline-flex items-center gap-2 text-label-md font-bold text-secondary">
              <Icon name="edit_calendar" size={18} />
              <span>{t("eyebrow")}</span>
            </div>
            <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
            <p className="max-w-2xl text-body-md leading-relaxed text-on-surface-variant">{t("subtitle")}</p>
          </div>
          <ApplyRoleCards />
        </div>
      </div>
    </section>
  );
}
