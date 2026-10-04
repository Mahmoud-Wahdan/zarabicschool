import { getTranslations } from "next-intl/server";

const quickLinks = [
  { href: "#subjects", key: "subjects" as const },
  { href: "#why", key: "why" as const },
  { href: "#steps", key: "howToStart" as const },
  { href: "#faq", key: "faq" as const },
  { href: "#apply", key: "apply" as const },
];

export default async function SiteFooter() {
  const t = await getTranslations("footer");
  const tBrand = await getTranslations("brand");
  const tNav = await getTranslations("nav");

  return (
    <footer className="bg-[var(--navy)] text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-lg font-bold">{tBrand("name")}</p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/85">{t("tagline")}</p>
        </div>

        <nav aria-label={t("linksTitle")}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--gold)]">
            {t("linksTitle")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-white/85">
            {quickLinks.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="transition hover:text-[var(--gold)]">
                  {tNav(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--gold)]">
            {t("contactTitle")}
          </h2>
          <p className="mt-3 text-sm text-white/85">{t("whatsapp")}</p>
        </div>
      </div>

      <div className="border-t border-white/15">
        <p className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-white/70">{t("rights")}</p>
      </div>
    </footer>
  );
}
