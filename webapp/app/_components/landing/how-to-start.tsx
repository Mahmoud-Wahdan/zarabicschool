import { getTranslations } from "next-intl/server";

export default async function HowToStart() {
  const t = await getTranslations("steps");
  const items = t.raw("items") as { title: string; text: string }[];

  return (
    <section id="steps" className="section-anchor bg-[var(--background)]">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold text-[var(--navy)] sm:text-3xl">{t("title")}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-[var(--foreground)]/80">{t("subtitle")}</p>
        <ol className="relative mt-12 grid grid-cols-1 gap-6 lg:grid-cols-4">
          <span
            aria-hidden
            className="pointer-events-none absolute start-8 top-7 hidden h-0.5 w-[calc(100%-4rem)] bg-[var(--gold)]/50 lg:block"
          />
          {items.map((item, index) => (
            <li key={item.title} className="relative rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
              <span className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)]/15 text-sm font-bold text-[var(--navy)]">
                {index + 1}
              </span>
              <h3 className="mt-4 text-lg font-bold text-[var(--navy)]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]/80">{item.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
