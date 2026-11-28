import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getPublicWhatsAppLink } from "@/lib/messaging/contact-number";
import { getPublicBusinessContact } from "@/lib/public-academy";
import ThemeSwitch from "../theme-switch";

const publicRoutes = {
  about: "/about",
  contact: "/contact",
  terms: "/terms",
  privacy: "/privacy",
  refund: "/refund-policy",
  delivery: "/service-delivery",
} as const;

type PublicPageKind = keyof typeof publicRoutes;

type LegalSection = {
  heading: string;
  body: string[];
};

export default async function LegalPage({ kind }: { kind: PublicPageKind }) {
  const [t, landing, common, locale, whatsapp] = await Promise.all([
    getTranslations("legal"),
    getTranslations("minimalLanding"),
    getTranslations("common"),
    getLocale(),
    getPublicWhatsAppLink(),
  ]);

  const sections = t.raw(`${kind}.sections`) as LegalSection[];
  const path = publicRoutes[kind];
  const isPolicy = kind === "terms" || kind === "privacy" || kind === "refund";
  const contact = kind === "contact" ? getPublicBusinessContact(locale, whatsapp) : null;

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col">
      <a href="#main" className="skip-link">
        {common("skipToContent")}
      </a>
      <header className="border-b border-outline-variant bg-surface-container-lowest/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2" aria-label="Zarabicschool">
            <Image
              src="/Brand/minimal-light-header.png"
              width={160}
              height={58}
              alt="Zarabicschool"
              className="dark:hidden"
              unoptimized
            />
            <Image
              src="/Brand/minimal-dark-header.png"
              width={160}
              height={58}
              alt="Zarabicschool"
              className="hidden dark:block"
              unoptimized
            />
          </Link>
          <div className="flex items-center gap-3 text-sm font-medium">
            <ThemeSwitch />
            <Link
              href={path}
              locale={locale === "ar" ? "en" : "ar"}
              className="rounded-lg border border-outline-variant px-2.5 py-1 hover:bg-surface-container-low"
            >
              {locale === "ar" ? "EN" : "ع"}
            </Link>
            <Link href="/login" className="text-primary hover:underline">
              {landing("login")}
            </Link>
            <Link href="/apply" className="btn btn-primary px-4 py-1.5 text-sm">
              {landing("apply")}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-14">
        <nav aria-label={t("navLabel")} className="mb-6 flex flex-wrap gap-2 text-xs font-semibold">
          {(Object.keys(publicRoutes) as PublicPageKind[]).map((item) => (
            <Link
              key={item}
              href={publicRoutes[item]}
              aria-current={kind === item ? "page" : undefined}
              className={`rounded-full border px-3 py-1 transition ${
                kind === item
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary/50"
              }`}
            >
              {t(`${item}.title`)}
            </Link>
          ))}
        </nav>

        <article className="z-card rounded-2xl p-6 sm:p-10 space-y-8">
          <header className="border-b border-outline-variant pb-6 space-y-2">
            {isPolicy && <p className="text-xs font-bold uppercase tracking-wider text-secondary">{t("eyebrow")}</p>}
            <h1 className="text-2xl sm:text-3xl font-bold text-primary">{t(`${kind}.title`)}</h1>
            <p className="text-sm text-on-surface-variant">{t(`${kind}.subtitle`)}</p>
            {isPolicy && <p className="text-xs text-on-surface-variant/80">{t("lastUpdated")}</p>}
          </header>

          {contact && (contact.email || contact.phone || contact.location) && (
            <dl className="space-y-4 text-sm sm:text-base">
              {contact.email && (
                <div>
                  <dt className="font-bold">{t("contact.email")}</dt>
                  <dd><a className="text-primary underline" href={`mailto:${contact.email}`}><bdi>{contact.email}</bdi></a></dd>
                </div>
              )}
              {contact.phone && (
                <div>
                  <dt className="font-bold">{t("contact.phone")}</dt>
                  <dd><a className="text-primary underline" href={`tel:${contact.phone}`}><bdi>{contact.phone}</bdi></a></dd>
                </div>
              )}
              {contact.location && (
                <div>
                  <dt className="font-bold">{t("contact.location")}</dt>
                  <dd>{contact.location}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="space-y-6">
            {sections.map((section) => (
              <section key={section.heading} className="space-y-2.5">
                <h2 className="text-lg font-bold text-primary">{section.heading}</h2>
                {section.body.map((paragraph, idx) => (
                  <p key={idx} className="text-sm sm:text-base leading-relaxed text-on-surface/85">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </div>

          <footer className="border-t border-outline-variant pt-6 flex flex-wrap items-center justify-between gap-4 text-sm">
            {kind !== "contact" && (
              <Link href="/contact" className="text-primary font-semibold hover:underline">{t("contact.title")}</Link>
            )}
            <div className="flex items-center gap-3">
              {whatsapp ? (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline px-4 py-2 text-sm"
                >
                  {landing("whatsapp")}
                </a>
              ) : null}
              <Link href="/" className="text-primary font-semibold hover:underline">
                {t("backHome")}
              </Link>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}
