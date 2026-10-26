import "server-only";

import { isPhase7FollowupReady } from "../phase7/readiness";
import { prisma } from "../prisma";
import { toInternationalDigits } from "../messaging/phone";

/**
 * Announcement recipients (owner, 2026-10-26): EVERYONE in the academy except the
 * senders' side — every active TEACHER, STUDENT and GUARDIAN (Admin and Supervisor
 * are excluded, follow-up 2026-10-26) — minus users an Admin flagged "no
 * announcements" (users.announcements_opt_out; they still see the in-app copy).
 * No new recipient rule otherwise: a student and their guardian
 * are separate users and each counts (the same as report notices), and the WhatsApp
 * list is deduped by PHONE NUMBER so one number (e.g. a guardian with several
 * children, or a child using the parent's number) gets ONE message. Users without
 * an addressable number still see the in-app copy.
 *
 * Deterministic: the user kept for a shared number is the earliest-created one, so
 * the confirmed count and the enqueued jobs match.
 */
export async function computeAnnouncementRecipients(academyId: string) {
  const optOutReady = await isPhase7FollowupReady();
  const users = await prisma.user.findMany({
    where: { academyId, isActive: true, role: { in: ["TEACHER", "STUDENT", "GUARDIAN"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, phone: true, ...(optOutReady ? { announcementsOptOut: true } : {}) },
  });
  const byNumber = new Map<string, string>();
  let withoutPhone = 0;
  let optedOut = 0;
  for (const user of users) {
    if ((user as { announcementsOptOut?: boolean }).announcementsOptOut) {
      optedOut += 1;
      continue;
    }
    const digits = toInternationalDigits(user.phone);
    if (!digits) {
      withoutPhone += 1;
      continue;
    }
    if (!byNumber.has(digits)) byNumber.set(digits, user.id);
  }
  const recipientUserIds = [...byNumber.values()];
  return {
    activeUsers: users.length,
    whatsappRecipients: recipientUserIds.length,
    withoutPhone,
    optedOut,
    sharedNumbersMerged: users.length - optedOut - withoutPhone - recipientUserIds.length,
    recipientUserIds,
  };
}

/** Counts only — what the composer shows before the explicit confirmation. */
export async function announcementRecipientSummary(academyId: string) {
  const recipients = await computeAnnouncementRecipients(academyId);
  return {
    activeUsers: recipients.activeUsers,
    whatsappRecipients: recipients.whatsappRecipients,
    withoutPhone: recipients.withoutPhone,
    optedOut: recipients.optedOut,
    sharedNumbersMerged: recipients.sharedNumbersMerged,
  };
}

export type AnnouncementView = {
  id: string;
  title: string;
  body: string;
  sentAt: Date;
  expiresAt: Date;
  authorName: string;
};

const VIEW_SELECT = {
  id: true,
  title: true,
  body: true,
  sentAt: true,
  expiresAt: true,
  createdBy: { select: { displayName: true } },
} as const;

function toView(row: { id: string; title: string; body: string; sentAt: Date; expiresAt: Date; createdBy: { displayName: string } }): AnnouncementView {
  return { id: row.id, title: row.title, body: row.body, sentAt: row.sentAt, expiresAt: row.expiresAt, authorName: row.createdBy.displayName };
}

/** Dashboard widget: announcements whose in-app copy has not expired yet. */
export async function getActiveAnnouncements(academyId: string, now = new Date(), take = 3): Promise<AnnouncementView[]> {
  const rows = await prisma.announcement.findMany({
    where: { academyId, expiresAt: { gt: now } },
    orderBy: { sentAt: "desc" },
    take,
    select: VIEW_SELECT,
  });
  return rows.map(toView);
}

/** History: every announcement, expired or not (expiry only hides the widget copy). */
export async function getAnnouncementHistory(academyId: string, take = 50): Promise<AnnouncementView[]> {
  const rows = await prisma.announcement.findMany({
    where: { academyId },
    orderBy: { sentAt: "desc" },
    take,
    select: VIEW_SELECT,
  });
  return rows.map(toView);
}

/**
 * Redacted delivery summary per announcement (Admin/Supervisor): job counts by
 * status only — never numbers, never bodies.
 */
export async function getAnnouncementDeliveryCounts(academyId: string, announcementIds: string[]) {
  const result = new Map<string, Record<string, number>>();
  if (!announcementIds.length) return result;
  const rows = (await prisma.$queryRaw`
    SELECT payload->>'announcementId' AS "announcementId", status::text AS status, COUNT(*)::int AS count
    FROM notification_jobs
    WHERE academy_id = ${academyId}::uuid
      AND kind = 'ANNOUNCEMENT'
      AND payload->>'announcementId' = ANY(${announcementIds}::text[])
    GROUP BY 1, 2`) as { announcementId: string; status: string; count: number }[];
  for (const row of rows) {
    const entry = result.get(row.announcementId) ?? {};
    entry[row.status] = row.count;
    result.set(row.announcementId, entry);
  }
  return result;
}
