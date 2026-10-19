"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "../../i18n/navigation";
import LocaleSwitcher from "./locale-switcher";
import SignOutButton from "./sign-out-button";

type NavItem = {
  key: string;
  icon: string;
  href: string;
  badgeKey?: "applications" | "reports" | "requests";
  badgeTone?: "secondary" | "tertiary";
};

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  ADMIN: [
    { key: "dashboard", icon: "grid_view", href: "/admin" },
    { key: "applications", icon: "mark_email_unread", href: "/admin/applications", badgeKey: "applications" },
    { key: "students", icon: "school", href: "/admin/students" },
    { key: "teachers", icon: "co_present", href: "/admin/teachers" },
    { key: "guardians", icon: "family_restroom", href: "/admin/guardians" },
    { key: "subjects", icon: "menu_book", href: "/admin/subjects" },
    { key: "assignments", icon: "hub", href: "/admin/assignments" },
    { key: "enrollments", icon: "how_to_reg", href: "/admin/enrollments" },
    { key: "sessions", icon: "video_camera_front", href: "/admin/sessions" },
    { key: "reports", icon: "fact_check", href: "/admin/reports", badgeKey: "reports", badgeTone: "tertiary" },
    { key: "monthlyReports", icon: "calendar_month", href: "/admin/monthly-reports" },
    { key: "sessionRequests", icon: "report_problem", href: "/admin/session-requests", badgeKey: "requests", badgeTone: "secondary" },
    { key: "financials", icon: "receipt_long", href: "/admin/financials" },
    { key: "invoices", icon: "request_quote", href: "/admin/invoices" },
    { key: "payroll", icon: "payments", href: "/admin/payroll" },
    { key: "overtime", icon: "more_time", href: "/admin/overtime" },
    { key: "accounts", icon: "manage_accounts", href: "/admin/users" },
  ],
  SUPERVISOR: [
    { key: "dashboard", icon: "grid_view", href: "/supervisor" },
    { key: "students", icon: "school", href: "/admin/students" },
    { key: "teachers", icon: "co_present", href: "/admin/teachers" },
    { key: "guardians", icon: "family_restroom", href: "/admin/guardians" },
    { key: "subjects", icon: "menu_book", href: "/admin/subjects" },
    { key: "assignments", icon: "hub", href: "/admin/assignments" },
    { key: "enrollments", icon: "how_to_reg", href: "/admin/enrollments" },
    { key: "sessions", icon: "video_camera_front", href: "/admin/sessions" },
    { key: "reports", icon: "fact_check", href: "/supervisor/reports", badgeKey: "reports", badgeTone: "tertiary" },
    { key: "monthlyReports", icon: "calendar_month", href: "/supervisor/monthly-reports" },
    { key: "sessionRequests", icon: "report_problem", href: "/supervisor/session-requests", badgeKey: "requests", badgeTone: "secondary" },
  ],
  TEACHER: [
    { key: "dashboard", icon: "dashboard", href: "/teacher" },
    { key: "mySessions", icon: "calendar_month", href: "/teacher/sessions" },
    { key: "monthlyReports", icon: "calendar_month", href: "/teacher/monthly-reports" },
    { key: "attendance", icon: "fact_check", href: "/teacher/attendance" },
    { key: "payroll", icon: "payments", href: "/teacher/payroll" },
  ],
  GUARDIAN: [
    { key: "dashboard", icon: "dashboard", href: "/guardian" },
    { key: "familySchedule", icon: "calendar_month", href: "/guardian/sessions" },
    { key: "attendance", icon: "event_available", href: "/guardian/attendance" },
    { key: "guardianReports", icon: "menu_book", href: "/guardian/reports" },
    { key: "invoices", icon: "request_quote", href: "/guardian/invoices" },
  ],
  STUDENT: [
    { key: "dashboard", icon: "dashboard", href: "/student" },
    { key: "mySessions", icon: "calendar_month", href: "/student/sessions" },
    { key: "attendance", icon: "event_available", href: "/student/attendance" },
    { key: "monthlyReports", icon: "calendar_month", href: "/student/monthly-reports" },
    { key: "invoices", icon: "request_quote", href: "/student/invoices" },
  ],
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({
  items,
  badges,
  onNavigate,
}: {
  items: NavItem[];
  badges?: Partial<Record<"applications" | "reports" | "requests", number>>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("appShell");

  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2" aria-label={t("primaryNav")}>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const badgeValue = item.badgeKey ? badges?.[item.badgeKey] : undefined;
        const badgeClasses =
          item.badgeTone === "tertiary"
            ? "bg-tertiary-container text-on-tertiary-container"
            : "bg-secondary text-on-secondary";
        return (
          <Link
            key={`${item.key}-${item.href}`}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={`sidebar-link ${active ? "sidebar-link--active" : ""}`}
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                {item.icon}
              </span>
              <span className="text-body-md">{t(`nav.${item.key}`)}</span>
            </span>
            {typeof badgeValue === "number" && badgeValue > 0 ? (
              <span className={`rounded-full px-1.5 py-0.5 text-label-sm ${badgeClasses}`}>{badgeValue}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function ShellClock({ timezone }: { timezone?: string }) {
  const locale = useLocale();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!timezone) return;
    const update = () => setNow(new Date());
    const raf = requestAnimationFrame(update);
    const timer = setInterval(update, 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [timezone]);

  if (!timezone || !now) return null;

  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  const time = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(now);
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;

  return (
    <div className="hidden items-center gap-1.5 rounded-lg bg-surface-container-low px-2 py-1.5 xl:flex">
      <span className="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">
        schedule
      </span>
      <span className="text-label-sm text-on-surface-variant">
        {city} ({offset}):
      </span>
      <span className="text-label-md font-semibold text-on-surface">{time}</span>
    </div>
  );
}

function UserMenu({ userName, roleLabel }: { userName: string; roleLabel: string }) {
  const t = useTranslations("appShell");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initials = userName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full bg-surface-container-low/50 p-1 ps-2 transition-colors hover:bg-surface-container"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-sm font-bold text-on-primary">
          {initials}
        </span>
        <span className="hidden flex-col text-start md:flex">
          <span className="text-body-sm font-semibold leading-tight text-on-surface">{userName}</span>
          <span className="text-label-sm leading-tight text-secondary">{roleLabel}</span>
        </span>
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="z-card-raised absolute end-0 top-[calc(100%+0.5rem)] flex w-56 flex-col gap-1 p-2"
        >
          <div className="flex flex-col border-b border-outline-variant px-2 pb-2">
            <span className="text-body-sm font-semibold text-on-surface">{userName}</span>
            <span className="text-label-sm text-on-surface-variant">{roleLabel}</span>
          </div>
          <SignOutButton className="btn btn-ghost-danger w-full" />
          <span className="sr-only">{t("userMenu")}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function DashboardShell({
  role,
  userName,
  timezone,
  navBadges,
  hideNavKeys,
  children,
}: {
  role: string;
  userName: string;
  timezone?: string;
  navBadges?: Partial<Record<"applications" | "reports" | "requests", number>>;
  /** Per-page server-side nav filtering — e.g. a STUDENT with a guardian hides "invoices" (CONTEXT §12 finance wall). */
  hideNavKeys?: string[];
  children: ReactNode;
}) {
  const t = useTranslations("appShell");
  const tDashboard = useTranslations("dashboard");
  const tBrand = useTranslations("brand");
  const tCommon = useTranslations("common");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const navItems = (NAV_BY_ROLE[role] ?? NAV_BY_ROLE.STUDENT).filter(
    (item) => !hideNavKeys?.includes(item.key),
  );
  const roleLabel = role === "ADMIN" ? tDashboard("roles.SUPERADMIN") : tDashboard(`roles.${role}`);
  const brandInitial = tBrand("name").trim().slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    drawerRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const brandChip = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-on-primary-container/60 bg-on-primary/5 text-base font-bold text-on-primary">
      {brandInitial}
    </span>
  );

  const brandBar = (onClose?: () => void) => (
    <div className="flex h-16 shrink-0 items-center justify-between bg-primary px-4">
      <span className="flex items-center gap-2">
        {brandChip}
        <span className="flex flex-col">
          <span className="text-headline-sm font-semibold leading-tight tracking-tight text-on-primary">
            {tBrand("name")}
          </span>
          <span className="text-label-sm uppercase tracking-wider text-on-primary-container">{t("portal")}</span>
        </span>
      </span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-on-primary transition-colors hover:bg-on-primary/10"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            close
          </span>
          <span className="sr-only">{t("closeMenu")}</span>
        </button>
      ) : (
        <LocaleSwitcher className="rounded-lg bg-surface-container-highest/20 px-1.5 py-0.5 text-label-sm text-on-primary transition-colors hover:bg-surface-container-highest/30" />
      )}
    </div>
  );

  const scopeChip = (
    <div className="bg-primary/40 p-2">
      <div className="flex items-center justify-between rounded-lg bg-surface-container-lowest/10 p-2">
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px] text-secondary-container" aria-hidden="true">
            verified_user
          </span>
          <span className="flex flex-col">
            <span className="text-label-sm uppercase leading-none text-on-primary-container">
              {t("activeScope")}
            </span>
            <span className="text-title-md leading-tight text-on-primary">{roleLabel}</span>
          </span>
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <a href="#main-content" className="skip-link">
        {tCommon("skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-50 hidden w-72 flex-col overflow-y-auto bg-primary-container text-on-primary shadow-[0_1px_8px_rgba(0,0,0,0.04)] lg:flex">
        {brandBar()}
        {scopeChip}
        <SidebarNav items={navItems} badges={navBadges} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-primary/45"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("primaryNav")}
            tabIndex={-1}
            className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-primary-container text-on-primary shadow-[var(--elev-3)] outline-none"
          >
            {brandBar(() => setDrawerOpen(false))}
            {scopeChip}
            <SidebarNav items={navItems} badges={navBadges} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:ps-72">
        <header className="fixed top-0 inset-x-0 z-40 flex h-16 items-center justify-between gap-3 bg-surface-container-lowest/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl lg:inset-x-auto lg:start-72 lg:end-0 lg:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="app-drawer"
              className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface lg:hidden"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                menu
              </span>
              <span className="sr-only">{t("openMenu")}</span>
            </button>
            <div className="lg:hidden">
              <LocaleSwitcher className="rounded-lg border border-outline-variant px-2 py-1 text-label-md text-on-surface-variant transition-colors hover:text-on-surface" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShellClock timezone={timezone} />
            <UserMenu userName={userName} roleLabel={roleLabel} />
          </div>
        </header>
        <main id="main-content" className="relative min-h-screen bg-surface pt-16">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
