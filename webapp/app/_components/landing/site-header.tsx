"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "../../../i18n/navigation";

export default function SiteHeader({ logo }: { logo: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("landing.nav");
  const tCommon = useTranslations("common");
  const tBrand = useTranslations("brand");
  const tNav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const navItems = [
    { href: "#top", key: "home" },
    { href: "#curriculum-section", key: "curriculum" },
    { href: "#pricing-plans", key: "pricing" },
    { href: "#about-academy", key: "about" },
    { href: "#admissions-form", key: "admissions" },
  ] as const;

  const brandChip = (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary text-tertiary-fixed shadow-[0_2px_6px_rgba(0,32,70,0.18)]">
      <span className="inline-flex h-8 w-8 items-center justify-center text-[var(--gold)]">
        {logo}
      </span>
    </span>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-surface-container-lowest/95 shadow-[0_1px_8px_rgba(27,54,93,0.06)] backdrop-blur-md">
      <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between gap-4 px-4 lg:px-8">
        <div className="flex items-center gap-6">
          <a href="#top" className="group flex items-center gap-3">
            {brandChip}
            <span className="flex flex-col text-start">
              <span className="text-headline-sm font-bold tracking-tight text-primary">
                {tBrand("name")}
              </span>
              <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                Zarabicschool • Live Academy
              </span>
            </span>
          </a>
          <span className="hidden h-6 w-px bg-surface-container-high xl:block" aria-hidden="true" />
          <div className="hidden items-center gap-1 xl:flex" lang={locale === "ar" ? "ar" : "en"}>
            <span className="rounded bg-surface-container-low px-2 py-1 text-label-md font-bold text-primary">
              {locale === "ar" ? "العربية" : "EN"}
            </span>
            <span className="text-label-sm text-outline-variant" aria-hidden="true">
              /
            </span>
            <Link
              href="/"
              locale={locale === "ar" ? "en" : "ar"}
              className="rounded px-2 py-1 text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
            >
              {locale === "ar" ? "EN" : "العربية"}
            </Link>
          </div>
        </div>

        <nav className="hidden items-center gap-1 lg:flex" aria-label={tBrand("name")}>
          {navItems.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="rounded-lg px-3 py-2 text-body-md text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
            >
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-surface-container-lowest px-4 py-2 text-label-md font-bold text-primary shadow-[0_1px_3px_rgba(27,54,93,0.06)] transition-all hover:bg-surface-container-low"
          >
            {tCommon("login")}
          </Link>
          <a
            href="#admissions-form"
            className="inline-flex items-center justify-center rounded-lg bg-secondary px-5 py-2.5 text-label-md font-bold text-on-secondary shadow-[0_2px_8px_rgba(0,107,95,0.22)] transition-all hover:bg-on-secondary-container active:scale-95"
          >
            {tCommon("applyNow")}
          </a>
          <Link
            href="/login"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary"
          >
            <span className="material-symbols-outlined text-[18px] text-on-primary" aria-hidden="true">
              person
            </span>
            <span className="sr-only">{tCommon("login")}</span>
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low lg:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="sr-only">{open ? tNav("closeMenu") : tNav("openMenu")}</span>
          <span aria-hidden className="flex flex-col gap-1.5">
            <span className={`block h-0.5 w-5 bg-current transition ${open ? "translate-y-2 rotate-45" : ""}`} />
            <span className={`block h-0.5 w-5 bg-current transition ${open ? "opacity-0" : ""}`} />
            <span className={`block h-0.5 w-5 bg-current transition ${open ? "-translate-y-2 -rotate-45" : ""}`} />
          </span>
        </button>
      </div>

      {open ? (
        <div id={menuId} className="border-t border-outline-variant bg-surface-container-lowest px-4 py-4 lg:hidden">
          <nav className="flex flex-col gap-1" aria-label={tBrand("name")}>
            {navItems.map((item) => (
              <a
                key={item.key}
                href={item.href}
                className="rounded-lg px-2 py-2.5 text-body-md font-medium text-on-surface hover:bg-surface-container-low"
                onClick={() => setOpen(false)}
              >
                {t(item.key)}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/"
              locale={locale === "ar" ? "en" : "ar"}
              className="rounded-lg border border-outline-variant px-3 py-2 text-center text-body-md font-semibold text-on-surface-variant"
              onClick={() => setOpen(false)}
            >
              {locale === "ar" ? "EN" : "العربية"}
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-outline-variant px-4 py-2.5 text-body-md font-bold text-primary"
              onClick={() => setOpen(false)}
            >
              {tCommon("login")}
            </Link>
            <a
              href="#admissions-form"
              className="inline-flex items-center justify-center rounded-lg bg-secondary px-5 py-3 text-body-md font-bold text-on-secondary"
              onClick={() => setOpen(false)}
            >
              {tCommon("applyNow")}
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
