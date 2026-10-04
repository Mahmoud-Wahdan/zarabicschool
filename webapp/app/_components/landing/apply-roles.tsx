import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";

const roles = ["guardian", "student", "teacher"] as const;

export default async function ApplyRoles() {
  const t = await getTranslations("apply");

  return (
    <section id="apply" className="section-anchor bg-[var(--navy)] text-white">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-white/85">{t("subtitle")}</p>
        <ul className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {roles.map((role) => {
            const points = t.raw(`${role}.points`) as string[];
            return (
              <li key={role} className="lift-card rounded-2xl border border-white/15 bg-white/5 p-6">
                <p className="text-sm font-semibold text-[var(--gold)]">{t(`${role}.title`)}</p>
                <h3 className="mt-2 text-xl font-bold">{t(`${role}.headline`)}</h3>
                <ul className="mt-4 space-y-2 text-sm text-white/85">
                  {points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <Link href={`/apply?type=${role}`} className="cta-primary mt-6 w-full">
                  {t(`${role}.cta`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
