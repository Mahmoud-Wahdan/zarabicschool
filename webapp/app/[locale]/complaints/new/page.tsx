import { getLocale, getTranslations } from "next-intl/server";

import ComplaintForm from "../../../_components/complaints/complaint-form";
import DashboardShell from "../../../_components/dashboard-shell";
import EmptyState from "../../../_components/ui/empty-state";
import { getComplaintParties, getComplaintSessions } from "../../../../lib/complaints/service";
import { requireRoles, studentFinanceBlocked } from "../../../../lib/dal";
import { isPhase7Ready } from "../../../../lib/phase7/readiness";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export async function generateMetadata() {
  const t = await getTranslations("complaintForm");
  return { title: `${t("title")} | Zarabicschool` };
}

/** File a complaint — TEACHER, STUDENT or GUARDIAN, about one of their sessions. */
export default async function NewComplaintPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const user = await requireRoles(["TEACHER", "STUDENT", "GUARDIAN"]);
  const [t, locale] = await Promise.all([getTranslations("complaintForm"), getLocale()]);
  const financeHidden = user.role === "STUDENT" ? await studentFinanceBlocked(user.id) : false;
  const { session } = await searchParams;
  const ready = await isPhase7Ready();
  const sessions = ready ? await getComplaintSessions(user) : [];
  const initialSessionId = sessions.some((row) => row.id === session) ? session : undefined;
  const initialOptions = initialSessionId ? await getComplaintParties(user, initialSessionId) : null;

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone} hideNavKeys={financeHidden ? ["invoices"] : undefined}>
      <h1 className="text-headline-md font-bold text-primary">{t("title")}</h1>
      <p className="mt-1 text-body-sm text-on-surface-variant">{t("subtitle")}</p>
      {!ready ? (
        <EmptyState icon="hourglass_top" title={t("pendingTitle")} description={t("pendingText")} />
      ) : sessions.length === 0 ? (
        <EmptyState icon="event_busy" title={t("noSessionsTitle")} description={t("noSessionsText")} />
      ) : (
        <ComplaintForm
          sessions={sessions.map((row) => ({
            id: row.id,
            label: `${locale === "ar" ? row.subject.nameAr : row.subject.nameEn} · ${formatSessionDateTime(row.scheduledStart, user.timezone, locale)}`,
          }))}
          initialSessionId={initialSessionId}
          initialParties={initialOptions?.parties ?? []}
          initialOtherParticipant={initialOptions?.otherParticipant ?? false}
        />
      )}
    </DashboardShell>
  );
}
