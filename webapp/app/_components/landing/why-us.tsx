import { GraduationCap, Users, Clock3, FileText, Wallet, UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

const icons = [GraduationCap, Users, Clock3, FileText, Wallet, UserRound];

export default async function WhyUs() {
  const t = await getTranslations("why");
  const items = t.raw("items") as { title: string; text: string }[];

  return (
    <section id="why" className="section-anchor bg-[var(--surface)]">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold text-[var(--navy)] sm:text-3xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[var(--foreground)]/80">{t("subtitle")}</p>
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => {
            const Icon = icons[index] ?? GraduationCap;
            return (
              <li key={item.title} className="lift-card rounded-2xl border border-[var(--line)] bg-[var(--background)] p-6">
                <Icon aria-hidden className="h-7 w-7 text-[var(--emerald)]" />
                <h3 className="mt-4 text-lg font-bold text-[var(--navy)]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]/80">{item.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
