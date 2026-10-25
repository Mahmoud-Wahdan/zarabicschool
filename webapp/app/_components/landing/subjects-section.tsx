import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";
import Icon from "../ui/icon";

const ICON_MAP: Record<string, string> = {
  "book-open": "auto_stories",
  languages: "translate",
  "message-circle": "forum",
  scale: "balance",
  calculator: "calculate",
};

const CHIP_TONES = [
  "bg-primary-fixed text-primary",
  "bg-secondary-container/50 text-secondary",
  "bg-tertiary-fixed text-on-tertiary-fixed",
  "bg-surface-container-high text-primary",
];

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
    subjects = await prisma.subject.findMany({
      where: { isActive: true },
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
    <section className="section-anchor w-full bg-surface-container-low py-16" id="curriculum-section">
      <div className="mx-auto max-w-[1600px] space-y-12 px-4 lg:px-8">
        <div className="max-w-3xl space-y-3 text-start">
          <div className="inline-flex items-center gap-2 text-label-md font-bold text-secondary">
            <Icon name="school" size={16} />
            <span>{t("eyebrow")}</span>
          </div>
          <h2 className="text-headline-lg font-bold text-primary">{t("title")}</h2>
          <p className="text-body-md text-on-surface-variant">{t("subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject, index) => {
            const iconName = (subject.icon && ICON_MAP[subject.icon]) || "school";
            const name = locale === "en" ? subject.nameEn : subject.nameAr;
            const description = locale === "en" ? subject.descriptionEn : subject.descriptionAr;
            return (
              <div
                key={subject.id}
                className="z-card flex flex-col justify-between gap-6 rounded-xl p-6 transition-shadow hover:shadow-md"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-lg ${CHIP_TONES[index % CHIP_TONES.length]}`}
                    >
                      <Icon name={iconName} size={26} />
                    </span>
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-headline-sm font-bold text-primary">{name}</h3>
                    {description ? (
                      <p className="text-body-sm text-on-surface-variant">{description}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-surface-container pt-4">
                  <span className="text-label-sm font-bold text-secondary">{t("units")}</span>
                  <a
                    href="#admissions-form"
                    className="inline-flex items-center gap-1 text-label-md font-bold text-primary transition-colors hover:text-secondary"
                  >
                    <span>{t("viewDetails")}</span>
                    <Icon name="arrow_forward" size={16} className="rtl:rotate-180" />
                  </a>
                </div>
              </div>
            );
          })}

          <div className="flex flex-col justify-between gap-6 rounded-xl bg-primary p-6 text-on-primary shadow-sm">
            <div className="space-y-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container-lowest/10 text-tertiary-fixed">
                <Icon name="tune" size={26} />
              </span>
              <div className="space-y-2">
                <h3 className="text-headline-sm font-bold text-on-primary">{t("customTitle")}</h3>
                <p className="text-body-sm text-on-primary/80">{t("customText")}</p>
              </div>
            </div>
            <div className="border-t border-on-primary/10 pt-4">
              <a
                href="#admissions-form"
                className="inline-flex w-full items-center justify-center rounded bg-secondary px-4 py-3 text-label-md font-bold text-on-secondary transition-all hover:bg-on-secondary-container"
              >
                {t("customCta")}
              </a>
            </div>
          </div>
        </div>

        {subjects.length === 0 ? (
          <p className="text-center text-body-md text-on-surface-variant">{t("empty")}</p>
        ) : null}
      </div>
    </section>
  );
}
