import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import Icon, { type IconName } from "../ui/icon";

type RoleKey = "guardian" | "student" | "teacher";

const ROLE_CONFIG: Record<RoleKey, {
  badgeTone: string;
  badgeIcon: IconName;
  iconTone: string;
  cardIcon: IconName;
  checkTone: string;
  ctaClass: string;
  footIcon: IconName;
}> = {
  guardian: {
    badgeTone: "bg-secondary-container text-on-secondary-container",
    badgeIcon: "star",
    iconTone: "text-secondary",
    cardIcon: "family_restroom",
    checkTone: "bg-secondary-container text-on-secondary-container",
    ctaClass: "bg-secondary text-on-secondary hover:brightness-95",
    footIcon: "schedule",
  },
  student: {
    badgeTone: "bg-surface-container-high text-primary",
    badgeIcon: "school",
    iconTone: "text-primary",
    cardIcon: "person",
    checkTone: "bg-surface-container-high text-primary",
    ctaClass: "bg-surface-container-high text-primary hover:bg-surface-container",
    footIcon: "schedule",
  },
  teacher: {
    badgeTone: "bg-tertiary-fixed text-on-tertiary-fixed",
    badgeIcon: "workspace_premium",
    iconTone: "text-tertiary",
    cardIcon: "co_present",
    checkTone: "bg-surface-container-high text-tertiary",
    ctaClass: "border border-outline-variant text-primary hover:bg-surface-container-low",
    footIcon: "description",
  },
};

export default async function ApplyRoleCards({ showFooters = true }: { showFooters?: boolean }) {
  const t = await getTranslations("landing.roleCards");
  const roles: RoleKey[] = ["guardian", "student", "teacher"];

  return (
    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
      {roles.map((role) => {
        const config = ROLE_CONFIG[role];
        const points = t.raw(`${role}.points`) as string[];
        return (
          <div
            key={role}
            className={`flex min-w-0 flex-col justify-between rounded-xl border ${
              role === "guardian" ? "border-secondary bg-surface shadow-[var(--elev-2)]" : "border-outline-variant/60 bg-surface-container-lowest"
            }`}
          >
            <div className="flex flex-1 flex-col justify-between gap-6 p-5 sm:p-7">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-container-low">
                    <Icon name={config.cardIcon} size={28} className={config.iconTone} />
                  </span>
                  <div>
                    <h3 className="text-headline-sm font-bold leading-snug text-primary">
                      {t(`${role}.title`)}
                    </h3>
                    <p className="text-label-sm text-on-surface-variant">{t(`${role}.subtitle`)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label-sm font-bold ${config.badgeTone}`}
                  >
                    <Icon name={config.badgeIcon} size={14} />
                    {t(`${role}.badge`)}
                  </span>
                </div>
                <p className="pt-1 text-body-md leading-relaxed text-on-surface-variant">
                  {t(`${role}.description`)}
                </p>
                <div className="space-y-2.5 pt-2">
                  {points.map((point) => (
                    <div key={point} className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${config.checkTone}`}
                      >
                        <Icon name="check" size={14} />
                      </span>
                      <span className="text-body-sm text-on-surface">{point}</span>
                    </div>
                  ))}
                  {role === "teacher" ? (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface-container-low p-3 text-label-sm text-on-surface-variant">
                      <Icon name="info" size={16} className="mt-0.5 shrink-0 text-tertiary" />
                      <span>{t("teacher.note")}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              {showFooters ? (
                <div className="space-y-2 pt-4">
                  <Link
                    href={`/apply?type=${role}`}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-label-md font-bold transition-colors ${config.ctaClass}`}
                  >
                    <span>{t(`${role}.cta`)}</span>
                    <Icon name="arrow_forward" size={18} className="rtl:rotate-180" />
                  </Link>
                  <div className="flex items-center justify-center gap-1.5 text-label-sm text-on-surface-variant">
                    <Icon name={config.footIcon} size={14} className={config.iconTone} />
                    <span>{t(`${role}.foot`)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
