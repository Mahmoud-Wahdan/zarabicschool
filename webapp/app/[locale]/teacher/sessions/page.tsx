import { CalendarDays } from "lucide-react";
import DashboardShell from "../../../_components/dashboard-shell";
import { requireRole } from "../../../../lib/dal";
import { prisma } from "../../../../lib/prisma";

export default async function TeacherSessionsPage() {
  const user = await requireRole("TEACHER");
  const sessions = await prisma.session.findMany({
    where: { academyId: user.academyId, teacher: { userId: user.id } },
    orderBy: { scheduledStart: "asc" },
    take: 100,
    include: { subject: { select: { nameEn: true, nameAr: true } }, students: { include: { student: { include: { user: { select: { displayName: true } } } } } } },
  });
  return <DashboardShell role={user.role} userName={user.displayName}><section className="relative overflow-hidden rounded-[2rem] bg-[var(--navy)] px-6 py-8 text-white"><CalendarDays className="h-8 w-8 text-[var(--gold)]" aria-hidden /><h1 className="mt-3 text-3xl font-bold">My sessions</h1><p className="mt-2 text-sm text-white/80">Your assigned sessions and enrolled students.</p></section><div className="mt-6 space-y-3">{sessions.map((session) => <article key={session.id} className="lift-card dashboard-card p-5"><div className="flex flex-wrap justify-between gap-3"><strong className="text-[var(--navy)]">{session.subject.nameEn}</strong><span className="text-sm opacity-70">{new Date(session.scheduledStart).toLocaleString()}</span></div><p className="mt-2 text-sm opacity-70">{session.status} · {session.sessionType} · {session.students.map((item) => item.student.user.displayName).join(", ")}</p></article>)}{!sessions.length ? <p className="dashboard-card p-5 text-sm opacity-70">No sessions scheduled.</p> : null}</div></DashboardShell>;
}
