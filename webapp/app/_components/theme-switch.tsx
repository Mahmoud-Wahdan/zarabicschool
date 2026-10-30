"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import Icon from "./ui/icon";

/**
 * Light / dark / device theme (owner, 2026-10-31). The choice lives in the `theme`
 * cookie (one year) so the root layout writes data-theme before the first paint;
 * "system" removes the cookie and the attribute, and the device setting applies.
 */
type Theme = "light" | "dark" | "system";
const ORDER: Theme[] = ["light", "dark", "system"];
const ICON = { light: "light_mode", dark: "dark_mode", system: "monitor" } as const;
const listeners = new Set<() => void>();

function readTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
    document.cookie = "theme=; path=/; max-age=0; samesite=lax";
  } else {
    root.dataset.theme = theme;
    document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  }
  listeners.forEach((listener) => listener());
}

export default function ThemeSwitch({ className = "" }: { className?: string }) {
  const t = useTranslations("theme");
  // The server cannot know the device setting; it renders "system" and the client
  // corrects it after hydration without a mismatch.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      className={`rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface ${className}`}
      aria-label={t("switch", { current: t(theme), next: t(next) })}
      title={t("switch", { current: t(theme), next: t(next) })}
      data-theme-choice={theme}
    >
      <Icon name={ICON[theme]} size={20} />
    </button>
  );
}
