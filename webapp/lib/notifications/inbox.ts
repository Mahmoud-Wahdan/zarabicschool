import "server-only";

import { prisma } from "../prisma";

/**
 * Notification inbox (S-06, D12; SQL S-4). Computed, never stored:
 * - every viewer: their OWN notification jobs (read state = notification_jobs.read_at);
 *   credentials and evaluation kinds never appear (the teacher evaluation wall);
 * - staff (Admin/Supervisor): team queues — new applications, reports waiting for
 *   review, pending outage requests, open complaints (staff only, D12), missing
 *   reports (ended, roster student without a report or a resolution, D50) and recent
 *   teacher flags — with per-user read state in notification_reads;
 * - money items (payment anomalies, renewals, payroll balance) reach the Admin only.
 * Items carry ids, a kind and a link — no names, phones, amounts or message text.
 */
export type InboxRole = "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
export type InboxViewer = { id: string; role: InboxRole; academyId: string };
export type InboxItem = { key: string; kind: string; href: string; read: boolean; createdAt: string };

const WINDOW_DAYS = 14;
const PER_SOURCE = 50;
const MAX_ITEMS = 100;
const HIDDEN_KINDS = ["CREDENTIALS"];
const MONEY_KIND = /PAYMENT|RENEWAL|INVOICE|PAYROLL|BALANCE|SETTLED|OVERTIME/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(`^(?:(?:JOB|APPLICATION|REPORT_REVIEW|SESSION_REQUEST|COMPLAINT|TEACHER_FLAG):${UUID}|MISSING_REPORT:${UUID}:${UUID})$`);

const HOME: Record<InboxRole, string> = { ADMIN: "/admin", SUPERVISOR: "/supervisor", TEACHER: "/teacher", STUDENT: "/student", GUARDIAN: "/guardian" };

export function isInboxKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && KEY_PATTERN.test(value);
}

/** Where a job of this kind is handled, for this viewer's role (paths without the locale). */
export function jobHref(kind: string, role: InboxRole, sessionId: string | null): string {
  const staff = role === "ADMIN" || role === "SUPERVISOR";
  if (kind === "ANNOUNCEMENT") return "/announcements";
  if (kind === "PAYMENT_ANOMALY") return "/admin/payment-audit";
  if (kind.startsWith("RENEWAL_") && kind.endsWith("_ADMIN")) return "/admin/renewals";
  if (kind.startsWith("RENEWAL_")) return role === "STUDENT" ? "/student/invoices" : "/guardian/invoices";
  if (kind === "INVOICE_PAYMENT_LINK") return role === "STUDENT" ? "/student/invoices" : "/guardian/invoices";
  if (kind === "TEACHER_PENDING_APPROVAL") return "/admin/teachers";
  if (kind === "SESSION_REQUEST" || kind === "TEACHER_LATE_START_ADMIN") return "/admin/session-requests";
  if (kind === "BALANCE_NEGATIVE") return "/admin/payroll";
  if (kind === "OVERTIME_DECISION") return "/teacher/payroll";
  if (kind === "PAYROLL_ADJUSTMENT") return role === "TEACHER" ? "/teacher/payroll" : "/admin/payroll";
  if (kind.startsWith("MONTHLY_REPORT")) return role === "TEACHER" ? "/teacher/monthly-reports" : staff ? "/admin/monthly-reports" : HOME[role];
  if (staff && sessionId && /ATTENDANCE|SETTLED/.test(kind)) return `/admin/sessions/${sessionId}`;
  if (/SESSION|REPORT|LATE_START|DAILY_SCHEDULE|SERIES/.test(kind)) return staff ? "/admin/sessions" : `${HOME[role]}/sessions`;
  return HOME[role];
}

async function ownJobs(viewer: InboxViewer, since: Date): Promise<InboxItem[]> {
  const jobs = await prisma.notificationJob.findMany({
    where: {
      recipientUserId: viewer.id,
      academyId: viewer.academyId,
      status: { in: ["PENDING", "SENT"] },
      kind: { notIn: HIDDEN_KINDS },
      NOT: { kind: { startsWith: "EVALUATION" } },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: PER_SOURCE,
    select: { id: true, kind: true, sessionId: true, readAt: true, createdAt: true },
  });
  return jobs
    // Defence in depth: the Supervisor never sees a money item, whoever enqueued it.
    .filter((job) => viewer.role === "ADMIN" || viewer.role !== "SUPERVISOR" || !MONEY_KIND.test(job.kind))
    .map((job) => ({ key: `JOB:${job.id}`, kind: job.kind, href: jobHref(job.kind, viewer.role, job.sessionId), read: job.readAt !== null, createdAt: job.createdAt.toISOString() }));
}

async function teamQueues(viewer: InboxViewer, since: Date, now: Date): Promise<Omit<InboxItem, "read">[]> {
  const academyId = viewer.academyId;
  const [applications, reports, requests, complaints, flags, ended] = await Promise.all([
    prisma.application.findMany({ where: { academyId, status: "NEW" }, orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true } }),
    prisma.report.findMany({ where: { academyId, status: "SUBMITTED" }, orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true } }),
    prisma.sessionRequest.findMany({ where: { academyId, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true } }),
    prisma.complaint.findMany({ where: { academyId, status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true } }),
    prisma.teacherFlag.findMany({ where: { academyId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true } }),
    prisma.session.findMany({
      where: { academyId, status: { notIn: ["CANCELLED", "MISSED"] }, scheduledEnd: { gte: since, lte: now } },
      orderBy: { scheduledEnd: "desc" },
      take: PER_SOURCE,
      select: {
        id: true,
        scheduledEnd: true,
        students: { select: { studentId: true } },
        reports: { where: { reportType: "SESSION_COMPLETION_REPORT", status: { in: ["SUBMITTED", "APPROVED", "ARCHIVED"] } }, select: { studentId: true } },
        attendanceResolutions: { select: { studentId: true } },
      },
    }),
  ]);
  const missing = ended.flatMap((session) => {
    const done = new Set([...session.reports.map((row) => row.studentId), ...session.attendanceResolutions.map((row) => row.studentId)]);
    return session.students
      .filter((row) => !done.has(row.studentId))
      .map((row) => ({ key: `MISSING_REPORT:${session.id}:${row.studentId}`, kind: "MISSING_REPORT", href: `/admin/sessions/${session.id}`, createdAt: session.scheduledEnd.toISOString() }));
  });
  return [
    ...applications.map((row) => ({ key: `APPLICATION:${row.id}`, kind: "APPLICATION_NEW", href: `/admin/applications/${row.id}`, createdAt: row.createdAt.toISOString() })),
    ...reports.map((row) => ({ key: `REPORT_REVIEW:${row.id}`, kind: "REPORT_TO_REVIEW", href: "/admin/reports", createdAt: row.createdAt.toISOString() })),
    ...requests.map((row) => ({ key: `SESSION_REQUEST:${row.id}`, kind: "SESSION_REQUEST_PENDING", href: "/admin/session-requests", createdAt: row.createdAt.toISOString() })),
    ...complaints.map((row) => ({ key: `COMPLAINT:${row.id}`, kind: "COMPLAINT_OPEN", href: `/admin/complaints/${row.id}`, createdAt: row.createdAt.toISOString() })),
    ...flags.map((row) => ({ key: `TEACHER_FLAG:${row.id}`, kind: "TEACHER_FLAG", href: "/admin/teachers", createdAt: row.createdAt.toISOString() })),
    ...missing,
  ];
}

export async function getInbox(viewer: InboxViewer, now = new Date()): Promise<InboxItem[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const staff = viewer.role === "ADMIN" || viewer.role === "SUPERVISOR";
  const [jobs, queues] = await Promise.all([ownJobs(viewer, since), staff ? teamQueues(viewer, since, now) : Promise.resolve([])]);
  const reads = queues.length
    ? new Set((await prisma.notificationRead.findMany({ where: { userId: viewer.id, itemKey: { in: queues.map((item) => item.key) } }, select: { itemKey: true } })).map((row) => row.itemKey))
    : new Set<string>();
  return [...jobs, ...queues.map((item) => ({ ...item, read: reads.has(item.key) }))]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ITEMS);
}

export async function countUnread(viewer: InboxViewer): Promise<number> {
  return (await getInbox(viewer)).filter((item) => !item.read).length;
}

/** Marks the viewer's own items read; a job of someone else, or a team key for a non-staff viewer, is ignored. */
export async function markInboxRead(viewer: InboxViewer, keys: string[] | "ALL"): Promise<number> {
  const targets = keys === "ALL" ? (await getInbox(viewer)).filter((item) => !item.read).map((item) => item.key) : keys;
  const jobIds = targets.filter((key) => key.startsWith("JOB:")).map((key) => key.slice(4));
  const staff = viewer.role === "ADMIN" || viewer.role === "SUPERVISOR";
  const teamKeys = staff ? targets.filter((key) => !key.startsWith("JOB:")) : [];
  const now = new Date();
  const [jobs, team] = await Promise.all([
    jobIds.length
      ? prisma.notificationJob.updateMany({ where: { id: { in: jobIds }, recipientUserId: viewer.id, readAt: null }, data: { readAt: now } })
      : Promise.resolve({ count: 0 }),
    teamKeys.length
      ? prisma.notificationRead.createMany({ data: teamKeys.map((itemKey) => ({ userId: viewer.id, itemKey, readAt: now })), skipDuplicates: true })
      : Promise.resolve({ count: 0 }),
  ]);
  return jobs.count + team.count;
}
