"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "../../../i18n/navigation";
import ThemeSwitch from "../theme-switch";
import Icon from "../ui/icon";

const navItems = [
  { href: "#top", key: "home" },
  { href: "#curriculum-section", key: "curriculum" },
  { href: "#pricing-plans", key: "pricing" },
  { href: "#about-academy", key: "about" },
  { href: "#admissions-form", key: "admissions" },
] as const;

export default function SiteHeader({ logo }: { logo: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("landing.nav");
  const tCommon = useTranslations("common");
  const tBrand = useTranslations("brand");
  const tNav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const nextLocale = locale === "ar" ? "en" : "ar";

  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() {
      if (desktop.matches) setOpen(false);
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [open]);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 border-b border-[var(--hairline)] bg-surface-container-lowest"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-2 px-[clamp(1.25rem,4vw,2.5rem)]">
        <a href="#top" className="flex min-w-0 items-center gap-2.5 text-start" onClick={() => setOpen(false)}>
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1b365d] text-[#e9c349]">
            <span className="inline-flex h-8 w-8 items-center justify-center">{logo}</span>
          </span>
          <span className="text-title-md font-bold text-primary sm:text-headline-sm">{tBrand("name")}</span>
        </a>
        <nav className="hidden items-center lg:flex" aria-label={tBrand("name")}>
          {navItems.map((item) => (
            <a key={item.key} href={item.href} className="rounded-lg px-2 py-2.5 text-body-md text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface xl:px-3">
              {t(item.key)}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Link
            href="/"
            locale={nextLocale}
            hrefLang={nextLocale}
            lang={nextLocale}
            className="hidden min-h-11 items-center rounded-lg px-2 text-label-md font-bold text-on-surface-variant hover:bg-surface-container-low sm:inline-flex"
          >
            {nextLocale === "en" ? "English" : "العربية"}
          </Link>
          <ThemeSwitch className="inline-flex h-11 w-11 items-center justify-center" />
          <Link href="/login" className="hidden min-h-11 items-center rounded-lg px-2.5 text-label-md font-bold text-primary hover:bg-surface-container-low lg:inline-flex">
            {tCommon("login")}
          </Link>
          <a href="#admissions-form" className="hidden min-h-11 items-center rounded-lg bg-secondary px-4 text-label-md font-bold text-on-secondary hover:underline lg:inline-flex">
            {tCommon("applyNow")}
          </a>
          <button
            ref={toggle}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low lg:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen(!open)}
          >
            <span className="sr-only">{open ? tNav("closeMenu") : tNav("openMenu")}</span>
            <Icon name={open ? "close" : "menu"} size={22} />
          </button>
        </div>
      </div>
      <div id={menuId} hidden={!open} className="max-h-[calc(100dvh-5rem)] overflow-y-auto border-t border-[var(--hairline)] bg-surface-container-lowest px-[clamp(1.25rem,4vw,2.5rem)] py-3 shadow-lg lg:hidden">
        <nav className="flex flex-col" aria-label={tBrand("name")}>
          {navItems.map((item) => (
            <a key={item.key} href={item.href} className="rounded-lg px-2 py-3 text-body-md font-medium text-on-surface hover:bg-surface-container-low" onClick={() => setOpen(false)}>
              {t(item.key)}
            </a>
          ))}
        </nav>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] pt-3">
          <Link href="/login" className="inline-flex min-h-11 items-center rounded-lg border border-outline-variant px-4 text-label-md font-bold text-primary" onClick={() => setOpen(false)}>
            {tCommon("login")}
          </Link>
          <a href="#admissions-form" className="inline-flex min-h-11 items-center rounded-lg bg-secondary px-4 text-label-md font-bold text-on-secondary" onClick={() => setOpen(false)}>
            {tCommon("applyNow")}
          </a>
          <Link href="/" locale={nextLocale} hrefLang={nextLocale} lang={nextLocale} className="ms-auto inline-flex min-h-11 items-center rounded-lg px-2 text-label-md font-semibold text-primary sm:hidden" onClick={() => setOpen(false)}>
            {nextLocale === "en" ? "English" : "العربية"}
          </Link>
        </div>
      </div>
    </header>
  );
}
