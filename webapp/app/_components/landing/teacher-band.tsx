import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import Icon from "../ui/icon";

export default async function TeacherBand() {
  const t = await getTranslations("landing.teacherBand");

  const perks = [t("p1"), t("p2"), t("p3")];

  return (
    <section className="w-full bg-primary py-14 text-on-primary">
      <div className="mx-auto max-w-[1600px] px-4 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-8 rounded-2xl bg-primary-container p-8 lg:grid-cols-12 lg:p-12">
          <div className="space-y-4 text-start lg:col-span-8">
            <div className="inline-flex items-center gap-2 rounded bg-on-primary/10 px-3 py-1 text-label-md font-bold text-tertiary-fixed">
              <Icon name="badge" size={18} />
              <span>{t("badge")}</span>
            </div>
            <h2 className="text-headline-lg font-bold text-on-primary">{t("title")}</h2>
            <p className="max-w-2xl text-body-md leading-relaxed text-on-primary/80">{t("subtitle")}</p>
            <div className="flex flex-wrap gap-4 pt-2 text-label-sm text-on-primary/90">
              {perks.map((perk) => (
                <span key={perk} className="flex items-center gap-1.5">
                  <Icon name="check" size={16} className="text-secondary-fixed" />
                  <span>{perk}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-start lg:col-span-4 lg:justify-end">
            <Link
              href="/apply?type=teacher"
              className="inline-flex items-center gap-2 rounded bg-secondary px-6 py-4 text-center text-label-md font-bold text-on-secondary shadow-lg transition-all hover:bg-on-secondary-container active:scale-95"
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
