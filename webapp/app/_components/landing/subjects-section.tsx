import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import Icon, { type IconName } from "../ui/icon";

const ICON_MAP: Record<string, IconName> = {
  "book-open": "auto_stories",
  languages: "translate",
  "message-circle": "forum",
  scale: "balance",
  calculator: "calculate",
};

export default async function SubjectsSection() {
  const locale = await getLocale();
  const t = await getTranslations("landing.curriculum");

  let subjects: {
    id: string;
    slug: string;
    nameAr: string;
    nameEn: string;
    descriptionAr: string | null;
    descriptionEn: string | null;
    icon: string | null;
  }[] = [];

  try {
    // The public academy's subjects only (same rule as GET /api/subjects): the landing
    // page listed every academy's active subjects.
    subjects = await prisma.subject.findMany({
      where: { isActive: true, academy: { name: "Zarabicschool" } },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        icon: true,
      },
    });
  } catch {
    subjects = [];
  }

  return (
    <section className="section-anchor w-full bg-surface-container-low py-14 md:py-20" id="curriculum-section">
      <div className="mx-auto max-w-7xl space-y-8 px-[clamp(1.25rem,4vw,2.5rem)]">
        <div className="max-w-3xl space-y-3 text-start">
          <h2 className="text-balance text-headline-lg-mobile font-bold text-primary md:text-headline-lg">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        {subjects.length > 0 ? (
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((subject) => {
              const iconName = (subject.icon && ICON_MAP[subject.icon]) || "school";
              const name = locale === "en" ? subject.nameEn : subject.nameAr;
              const description = locale === "en" ? subject.descriptionEn : subject.descriptionAr;
              return (
                <article key={subject.id} className="flex flex-col items-start gap-3 border-t border-outline-variant pt-5">
                  <div className="flex items-center gap-3">
                    <Icon name={iconName} size={24} className="shrink-0 text-secondary" />
                    <h3 className="text-headline-sm font-bold text-primary">{name}</h3>
                  </div>
                  {description ? <p className="text-body-md text-on-surface-variant">{description}</p> : null}
                  <a href="#admissions-form" className="mt-auto inline-flex min-h-11 items-center gap-2 text-label-md font-bold text-secondary hover:underline">
                    {t("viewDetails")}
                    <Icon name="arrow_forward" size={16} className="rtl:rotate-180" />
                  </a>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant">{t("empty")}</p>
        )}

        <div className="flex flex-col items-start gap-5 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <h3 className="text-headline-sm font-bold text-primary">{t("customTitle")}</h3>
            <p className="text-body-md text-on-surface-variant">{t("customText")}</p>
          </div>
          <a href="#admissions-form" className="inline-flex min-h-11 items-center gap-2 text-label-md font-bold text-secondary hover:underline">
            {t("customCta")}
            <Icon name="arrow_forward" size={18} className="shrink-0 rtl:rotate-180" />
          </a>
        </div>
      </div>
    </section>
  );
}
