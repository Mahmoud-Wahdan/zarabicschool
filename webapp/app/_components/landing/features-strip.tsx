import { MonitorPlay, GraduationCap, FileText, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

const icons = [MonitorPlay, GraduationCap, FileText, Users];

export default async function FeaturesStrip() {
  const t = await getTranslations("features");
  const items = t.raw("items") as { title: string; text: string }[];

  return (
    <section className="bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => {
          const Icon = icons[index] ?? GraduationCap;
          return (
            <article key={item.title} className="lift-card rounded-2xl border border-[var(--line)] bg-[var(--background)] p-5">
              <Icon aria-hidden className="h-7 w-7 text-[var(--emerald)]" />
              <h2 className="mt-3 text-lg font-bold text-[var(--navy)]">{item.title}</h2>
              <p className="mt-1 text-sm text-[var(--foreground)]/80">{item.text}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
