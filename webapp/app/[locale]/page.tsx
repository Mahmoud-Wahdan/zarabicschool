import Image from "next/image";
import { useTranslations } from "next-intl";

import LocaleSwitcher from "../_components/locale-switcher";
import { Link } from "../../i18n/navigation";
import { siteConfig } from "../../lib/site-config";

export default function Home() {
  const t = useTranslations("home");

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-5xl justify-end px-4 pt-4">
        <LocaleSwitcher />
      </div>

      <section className="bg-[var(--navy)] text-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-4 py-16 text-center sm:py-20">
          {siteConfig.logo.src ? (
            <Image
              src={siteConfig.logo.src}
              alt={siteConfig.logo.alt}
              width={160}
              height={160}
              priority
              className="mb-6"
            />
          ) : (
            <span
              aria-hidden
              className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border-2 border-[var(--gold)] text-2xl font-bold"
            >
              زع
            </span>
          )}
          <h1 className="text-3xl font-bold sm:text-4xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-lg opacity-90">{t("tagline")}</p>
          <Link
            href="/login"
            className="mt-8 rounded-lg bg-[var(--emerald)] px-8 py-3 font-semibold text-white transition hover:opacity-90"
          >
            {t("login")}
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-xl font-bold text-[var(--navy)]">{t("whatWeTeach.title")}</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { title: t("whatWeTeach.arabic"), description: t("whatWeTeach.arabicDescription") },
            { title: t("whatWeTeach.quran"), description: t("whatWeTeach.quranDescription") },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-[var(--line)] bg-white p-6 text-center">
              <h3 className="text-lg font-semibold text-[var(--navy)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center text-xl font-bold text-[var(--navy)]">{t("howItWorks.title")}</h2>
          <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["step1", "step2", "step3", "step4"].map((key, index) => (
              <li key={key} className="rounded-xl border border-[var(--line)] p-6 text-center">
                <span
                  aria-hidden
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--gold)]/15 text-sm font-bold text-[var(--gold)]"
                >
                  {index + 1}
                </span>
                <p className="mt-3 text-sm text-[var(--foreground)]">{t(`howItWorks.${key}`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-xl font-bold text-[var(--navy)]">{t("applyTitle")}</h2>
        <p className="mt-2 text-center text-sm text-[var(--foreground)] opacity-60">
          {t("applySubtitle")}
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { title: t("applyGuardian"), description: t("applyGuardianDescription") },
            { title: t("applyStudent"), description: t("applyStudentDescription") },
            { title: t("applyTeacher"), description: t("applyTeacherDescription") },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-[var(--line)] bg-white p-6 text-center">
              <h3 className="font-semibold text-[var(--navy)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--foreground)] opacity-60">{item.description}</p>
              <span className="mt-4 inline-block rounded-full bg-[var(--gold)]/10 px-3 py-1 text-xs font-medium text-[var(--gold)]">
                {t("comingSoon")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
