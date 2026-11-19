"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Icon from "../ui/icon";

export default function MobileNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const t = useTranslations("nav");
  return <div className="ml-menu" onKeyDown={event => {
    if (event.key === "Escape" && open) {
      setOpen(false);
      button.current?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={button} type="button" aria-expanded={open} aria-controls={id}
      aria-label={open ? t("closeMenu") : t("openMenu")} onClick={() => setOpen(value => !value)}>
      <Icon name={open ? "close" : "menu"} />
    </button>
    <div id={id} hidden={!open} onClick={event => {
      if ((event.target as Element).closest("a")) setOpen(false);
    }}>{children}</div>
  </div>;
}
