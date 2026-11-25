import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getPublicWhatsAppLink } from "@/lib/messaging/contact-number";
import ThemeSwitch from "../theme-switch";

type LegalPageProps = {
  kind: "terms" | "privacy" | "refund";
};

type LegalSection = {
  heading: string;
  body: string[];
};

export default async function LegalPage({ kind }: LegalPageProps) {
  const [t, landing, common, locale, whatsapp] = await Promise.all([
    getTranslations("legal"),
    getTranslations("minimalLanding"),
    getTranslations("common"),
    getLocale(),
    getPublicWhatsAppLink(),
  ]);

  const sections = t.raw(`${kind}.sections`) as LegalSection[];
  const path = kind === "terms" ? "/terms" : kind === "privacy" ? "/privacy" : "/refund-policy";

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
          <Link
            href="/terms"
            className={`rounded-full border px-3 py-1 transition ${
              kind === "terms"
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary/50"
            }`}
          >
            {t("terms.title")}
          </Link>
          <Link
            href="/privacy"
            className={`rounded-full border px-3 py-1 transition ${
              kind === "privacy"
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary/50"
            }`}
          >
            {t("privacy.title")}
          </Link>
          <Link
            href="/refund-policy"
            className={`rounded-full border px-3 py-1 transition ${
              kind === "refund"
                ? "border-primary bg-primary text-on-primary"
                : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-primary/50"
            }`}
          >
            {t("refund.title")}
          </Link>
        </nav>

        <article className="z-card rounded-2xl p-6 sm:p-10 space-y-8">
          <header className="border-b border-outline-variant pb-6 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary">{t("eyebrow")}</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-primary">{t(`${kind}.title`)}</h1>
            <p className="text-sm text-on-surface-variant">{t(`${kind}.subtitle`)}</p>
            <p className="text-xs text-on-surface-variant/80">{t("lastUpdated")}</p>
          </header>

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
            <p className="text-on-surface-variant">{t("contactPrompt")}</p>
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
