import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import Icon from "../ui/icon";

export default async function TeacherBand() {
  const t = await getTranslations("landing.teacherBand");

  const perks = [t("p1"), t("p2"), t("p3")];

  return (
    <section className="w-full border-y border-outline-variant/45 bg-surface-container-low py-9 md:py-11">
      <div className="mx-auto max-w-7xl px-[clamp(1.25rem,4vw,2.5rem)]">
        <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
          <div className="space-y-4 text-start lg:col-span-8">
            <h2 className="text-balance text-headline-md font-bold text-primary">{t("title")}</h2>
            <p className="max-w-2xl text-body-md leading-relaxed text-on-surface-variant">{t("subtitle")}</p>
            <div className="flex flex-wrap gap-4 pt-2 text-label-sm text-on-surface-variant">
              {perks.map((perk) => (
                <span key={perk} className="flex items-center gap-1.5">
                  <Icon name="check" size={16} className="text-secondary" />
                  <span>{perk}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-start lg:col-span-4 lg:justify-end">
            <Link
              href="/apply?type=teacher"
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-5 py-3 text-center text-label-md font-bold text-primary transition-colors hover:border-secondary hover:text-secondary"
            >
              <Icon name="how_to_reg" size={20} />
              <span>{t("cta")}</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
