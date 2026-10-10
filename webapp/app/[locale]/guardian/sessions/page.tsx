import { CalendarDays } from "lucide-react";
import { getLocale } from "next-intl/server";
import DashboardShell from "../../../_components/dashboard-shell";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";
import { formatSessionDateTime } from "../../../../lib/schedules/display";

export default async function GuardianSessionsPage() {
  const user = await requireRole("GUARDIAN");
  const locale = await getLocale();
  const sessions = await prisma.session.findMany({
    where: { academyId: user.academyId, students: { some: { student: { guardian: { userId: user.id } } } } },
    orderBy: { scheduledStart: "asc" },
    take: 100,
    include: { subject: { select: { nameEn: true, nameAr: true } }, teacher: { include: { user: { select: { displayName: true } } } }, students: { include: { student: { include: { user: { select: { displayName: true } } } } } } },
  });
  return <DashboardShell role={user.role} userName={user.displayName}><section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white"><CalendarDays className="h-8 w-8 text-[var(--gold)]" aria-hidden /><h1 className="mt-3 text-3xl font-bold">Family schedule</h1><p className="mt-2 text-sm text-white/80">A consolidated view of your children’s sessions.</p></section><div className="mt-6 space-y-3">{sessions.map((session) => <article key={session.id} className="lift-card dashboard-card p-5"><div className="flex flex-wrap justify-between gap-3"><strong className="text-[var(--navy)]">{session.subject.nameEn}</strong><span className="text-sm opacity-70">{formatSessionDateTime(session.scheduledStart, user.timezone, locale)}</span></div><p className="mt-2 text-sm opacity-70">{session.teacher.user.displayName} · {session.students.map((item) => item.student.user.displayName).join(", ")} · {session.status}</p>{session.status === "SCHEDULED" ? <a href={`/api/sessions/${session.id}/join`} target="_blank" rel="noreferrer" className="cta-primary mt-4 rounded-xl px-4 py-2 text-sm">Open Zoom</a> : null}</article>)}{!sessions.length ? <p className="dashboard-card p-5 text-sm opacity-70">No sessions scheduled.</p> : null}</div></DashboardShell>;
}
