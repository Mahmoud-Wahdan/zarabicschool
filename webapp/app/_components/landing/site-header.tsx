"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Link } from "../../../i18n/navigation";
import LocaleSwitcher from "../locale-switcher";

const navItems = [
  { href: "#subjects", key: "subjects" as const },
  { href: "#steps", key: "howToStart" as const },
  { href: "#why", key: "why" as const },
  { href: "#faq", key: "faq" as const },
  { href: "#apply", key: "apply" as const },
];

export default function SiteHeader({ logo }: { logo: ReactNode }) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tBrand = useTranslations("brand");
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

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="#top" className="flex items-center gap-3">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center">{logo}</span>
          <span className="hidden text-sm font-bold text-[var(--navy)] sm:inline">{tBrand("name")}</span>
        </a>

        <nav className="hidden items-center gap-5 lg:flex" aria-label={tBrand("name")}>
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className="text-sm font-medium text-[var(--navy)] hover:text-[var(--emerald)]">
              {tNav(item.key)}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LocaleSwitcher />
          <Link href="/login" className="cta-secondary px-4 py-2 text-sm">
            {tCommon("login")}
          </Link>
          <a href="#apply" className="cta-primary px-4 py-2 text-sm">
            {tCommon("applyNow")}
          </a>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--navy)] lg:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? tNav("closeMenu") : tNav("openMenu")}
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
        <div id={menuId} className="border-t border-[var(--line)] bg-[var(--surface)] px-4 py-4 lg:hidden">
          <nav className="flex flex-col gap-3" aria-label={tBrand("name")}>
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-xl px-2 py-2 text-base font-medium text-[var(--navy)]"
                onClick={() => setOpen(false)}
              >
                {tNav(item.key)}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <LocaleSwitcher />
            <Link href="/login" className="cta-secondary w-full" onClick={() => setOpen(false)}>
              {tCommon("login")}
            </Link>
            <a href="#apply" className="cta-primary w-full" onClick={() => setOpen(false)}>
              {tCommon("applyNow")}
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
