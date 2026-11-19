import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  eyebrowMeta,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  eyebrowMeta?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col justify-between gap-3 border-b border-outline-variant pb-4 xl:flex-row xl:items-end">
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <div className="flex flex-wrap items-center gap-1.5 text-label-sm uppercase tracking-wider text-secondary">
            <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
            <span>{eyebrow}</span>
            {eyebrowMeta ? (
              <>
                <span className="text-on-surface-variant/40" aria-hidden="true">
                  /
                </span>
                <span className="font-medium text-on-surface-variant">{eyebrowMeta}</span>
              </>
            ) : null}
          </div>
        ) : null}
        <h1 className="text-headline-lg-mobile font-bold tracking-tight text-primary sm:text-headline-lg">{title}</h1>
        {subtitle ? <p className="text-body-sm text-on-surface-variant">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 xl:pt-0">{actions}</div>
      ) : null}
    </header>
  );
}
