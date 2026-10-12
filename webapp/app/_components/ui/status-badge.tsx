import Icon from "./icon";

export type BadgeTone =
  | "live"
  | "pending"
  | "honor"
  | "info"
  | "danger"
  | "neutral"
  | "role"
  | "success";

const TONE_CLASSES: Record<BadgeTone, string> = {
  live: "badge--live",
  pending: "badge--pending",
  honor: "badge--honor",
  info: "badge--info",
  danger: "badge--danger",
  neutral: "badge--neutral",
  role: "badge--role",
  success: "badge--success",
};

export default function StatusBadge({
  tone,
  icon,
  pulse = false,
  children,
}: {
  tone: BadgeTone;
  icon?: string;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge ${TONE_CLASSES[tone]}`}>
      {tone === "live" ? (
        <span className={`badge-dot ${pulse ? "badge-dot--pulse" : ""}`} aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={12} />
      ) : null}
      {children}
    </span>
  );
}
