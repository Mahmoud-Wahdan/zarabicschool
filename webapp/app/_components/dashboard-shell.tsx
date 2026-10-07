import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import LocaleSwitcher from "./locale-switcher";
import SignOutButton from "./sign-out-button";
import LogoPlaceholder from "./logo-placeholder";

export default function DashboardShell({
  role,
  userName,
  children,
}: {
  role: string;
  userName: string;
  children: ReactNode;
}) {
  const t = useTranslations("dashboard");
  const roleLabel = role === "ADMIN" ? t("roles.SUPERADMIN") : t(`roles.${role}`);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--navy)] p-1">
              <LogoPlaceholder />
            </span>
            <div>
              <p className="text-sm font-bold text-[var(--navy)]">Zarabicschool</p>
              <p className="text-xs text-[var(--foreground)] opacity-60">{roleLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LocaleSwitcher />
            <span className="hidden text-sm text-[var(--foreground)] sm:inline">{userName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
