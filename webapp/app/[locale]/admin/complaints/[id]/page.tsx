import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import ComplaintActions from "../../../../_components/complaints/complaint-actions";
import DashboardShell from "../../../../_components/dashboard-shell";
import ClickTimeline from "../../../../_components/sessions/click-timeline";
import StatusBadge from "../../../../_components/ui/status-badge";
import { Link } from "../../../../../i18n/navigation";
import { requireRoles } from "../../../../../lib/dal";
import { complaintRoster } from "../../../../../lib/complaints/service";
import { isPhase7Ready } from "../../../../../lib/phase7/readiness";
import { prisma } from "../../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../../lib/schedules/display";
import { getClickTimelines } from "../../../../../lib/sessions/click-timeline";

/**
 * One complaint (ADMIN/SUPERVISOR only — 404 for anyone else is handled by
 * requireRoles redirect; there is no other read path). Shows the session's
 * read-only "link click time" list as evidence, never as attendance.
 */
export default async function AdminComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
  const [t, locale] = await Promise.all([getTranslations("complaintsAdmin"), getLocale()]);
  const { id } = await params;
  if (!z.guid().safeParse(id).success || !(await isPhase7Ready())) notFound();

  const complaint = await prisma.complaint.findFirst({
    where: { id, academyId: user.academyId },
    select: {
      id: true,
      sessionId: true,
      title: true,
      body: true,
      category: true,
      status: true,
      filedByRole: true,
      concernedRole: true,
      resolutionNote: true,
      resolvedAt: true,
      createdAt: true,
      filedBy: { select: { displayName: true } },
      concernedUser: { select: { displayName: true } },
      handledBy: { select: { displayName: true } },
      session: {
        select: {
          scheduledStart: true,
          status: true,
          subject: { select: { nameAr: true, nameEn: true } },
          teacher: { select: { user: { select: { displayName: true } } } },
        },
      },
      rosterStudentIds: true,
    },
  });
  if (!complaint) notFound();
  // Roster, for complaints about "another participant" (unnamed by the filer): the
  // students on the session when it was filed (D41, SQL S-9), else the current roster.
  const [timelines, roster] = await Promise.all([
    getClickTimelines(user, [complaint.sessionId]),
    complaintRoster(user.academyId, { sessionId: complaint.sessionId, rosterStudentIds: complaint.rosterStudentIds }),
  ]);

  return (
    <DashboardShell role={user.role} userName={user.displayName} timezone={user.timezone}>
      <Link href="/admin/complaints" className="text-label-md text-secondary">
        ← {t("backToList")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-headline-md font-bold text-primary">{complaint.title}</h1>
        <StatusBadge tone={complaint.status === "NEW" ? "danger" : complaint.status === "IN_PROGRESS" ? "pending" : "success"}>
          {t(`status.${complaint.status}`)}
        </StatusBadge>
      </div>
      <section className="z-card mt-4 flex flex-col gap-2 rounded-xl p-4 text-body-sm">
        <p>
          <strong>{t("categoryLabel")}:</strong> {t(`category.${complaint.category}`)}
        </p>
        <p>
          <strong>{t("filedByLabel")}:</strong> {complaint.filedBy.displayName} ({t(`role.${complaint.filedByRole}`)})
        </p>
        <p>
          <strong>{t("concernedLabel")}:</strong>{" "}
          {complaint.concernedUser && complaint.concernedRole
            ? `${complaint.concernedUser.displayName} (${t(`role.${complaint.concernedRole}`)})`
            : t("concernedOther")}
        </p>
        {!complaint.concernedUser ? (
          <div className="rounded-lg border border-outline-variant p-3">
            <p className="font-semibold text-primary">{t("rosterTitle")}</p>
            <p className="text-on-surface-variant">{t("rosterHint")}</p>
            <ul className="mt-1 list-inside list-disc">
              {roster.map((student) => (
                <li key={student.userId}>
                  {student.name} ({t("role.STUDENT")})
                  {student.guardianName ? ` · ${student.guardianName} (${t("role.GUARDIAN")})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>
          <strong>{t("sessionLabel")}:</strong> {locale === "ar" ? complaint.session.subject.nameAr : complaint.session.subject.nameEn} ·{" "}
          {complaint.session.teacher.user.displayName} · {formatSessionDateTime(complaint.session.scheduledStart, user.timezone, locale)}{" "}
          <Link href={`/admin/sessions/${complaint.sessionId}`} className="text-secondary underline-offset-2 hover:underline">
            {t("openSession")}
          </Link>
        </p>
        <p>
          <strong>{t("receivedLabel")}:</strong> {formatSessionDateTime(complaint.createdAt, user.timezone, locale)}
        </p>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-container-lowest p-3 text-body-md">{complaint.body}</p>
        {complaint.status === "RESOLVED" ? (
          <div className="mt-2 rounded-lg border border-outline-variant p-3">
            <p className="font-semibold text-primary">
              {t("resolvedBy", { name: complaint.handledBy?.displayName ?? "—" })}
              {complaint.resolvedAt ? ` · ${formatSessionDateTime(complaint.resolvedAt, user.timezone, locale)}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{complaint.resolutionNote}</p>
          </div>
        ) : complaint.handledBy ? (
          <p className="text-on-surface-variant">{t("handledBy", { name: complaint.handledBy.displayName })}</p>
        ) : null}
      </section>
      <div className="mt-4">
        <ClickTimeline entries={timelines.get(complaint.sessionId) ?? []} timeZone={user.timezone || "Africa/Cairo"} locale={locale} />
      </div>
      <ComplaintActions complaintId={complaint.id} status={complaint.status} />
    </DashboardShell>
  );
}
