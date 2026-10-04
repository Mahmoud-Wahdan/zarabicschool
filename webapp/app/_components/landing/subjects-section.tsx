import {
  BookOpen,
  Calculator,
  GraduationCap,
  Languages,
  MessageCircle,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { prisma } from "../../../lib/prisma";

const iconMap: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  languages: Languages,
  "message-circle": MessageCircle,
  scale: Scale,
  calculator: Calculator,
};

export default async function SubjectsSection() {
  const locale = await getLocale();
  const t = await getTranslations("subjects");

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
    <section id="subjects" className="section-anchor bg-[var(--background)]">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold text-[var(--navy)] sm:text-3xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[var(--foreground)]/80">{t("subtitle")}</p>

        {subjects.length === 0 ? (
          <p className="mt-10 text-center text-[var(--navy)]">{t("empty")}</p>
        ) : (
          <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((subject) => {
              const Icon = (subject.icon && iconMap[subject.icon]) || GraduationCap;
              const name = locale === "en" ? subject.nameEn : subject.nameAr;
              const description = locale === "en" ? subject.descriptionEn : subject.descriptionAr;
              return (
                <li key={subject.id} className="lift-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
                  <Icon aria-hidden className="h-8 w-8 text-[var(--emerald)]" />
                  <h3 className="mt-4 text-lg font-bold text-[var(--navy)]">{name}</h3>
                  {description ? (
                    <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]/80">{description}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-center text-sm text-[var(--foreground)]/70">{t("more")}</p>
        <div className="mt-4 flex justify-center">
          <a href="#apply" className="cta-primary">
            {t("cta")}
          </a>
        </div>
      </div>
    </section>
  );
}
