import type { ReactNode } from "react";

import Icon from "./icon";
import StatusBadge, { type BadgeTone } from "./status-badge";

const ICON_TONE_CLASSES = {
  secondary: "bg-secondary-fixed/30 text-secondary",
  tertiary: "bg-tertiary-fixed/40 text-tertiary",
  error: "bg-error-container/60 text-error",
  info: "bg-primary-fixed/50 text-primary",
  navy: "bg-surface-container-high text-primary-container",
} as const;

export default function MetricTile({
  label,
  icon,
  iconTone = "secondary",
  value,
  valueLabel,
  badge,
  children,
}: {
  label: string;
  icon: string;
  iconTone?: keyof typeof ICON_TONE_CLASSES;
  value: string | number;
  valueLabel?: string;
  badge?: { tone: BadgeTone; text: string; pulse?: boolean };
  children?: ReactNode;
}) {
  return (
    <div className="z-card group relative flex flex-col justify-between overflow-hidden rounded-xl p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-on-surface-variant">
          <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
          {label}
        </span>
        <span className={`rounded-lg p-2 ${ICON_TONE_CLASSES[iconTone]}`}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="my-3 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-display-hero font-bold leading-none tracking-tight text-primary">{value}</span>
          {valueLabel ? <span className="text-label-md text-on-surface-variant">{valueLabel}</span> : null}
        </div>
        {badge ? (
          <StatusBadge tone={badge.tone} pulse={badge.pulse}>
            {badge.text}
          </StatusBadge>
        ) : null}
      </div>
      {children ? <div className="pt-1">{children}</div> : null}
    </div>
  );
}
