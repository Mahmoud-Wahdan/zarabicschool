"use client";

import { useLocale, useTranslations } from "next-intl";
import { signOut } from "next-auth/react";

export default function SignOutButton() {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: `/${locale}/login` })}
      className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:border-[var(--emerald)] hover:text-[var(--emerald)]"
    >
      {t("signOut")}
    </button>
  );
}
