import { NextResponse } from "next/server";
import { z } from "zod";

import { computeAnnouncementRecipients, getAnnouncementHistory } from "../../../lib/announcements/service";
import {
  ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS,
  ANNOUNCEMENT_MAX_EXPIRY_DAYS,
  ANNOUNCEMENT_MAX_PER_AUTHOR_PER_HOUR,
  ANNOUNCEMENT_MAX_PER_DAY,
} from "../../../lib/config/announcements";
import { requireApiRoles } from "../../../lib/dal";
import { isPhase7Ready } from "../../../lib/phase7/readiness";
import { prisma } from "../../../lib/prisma";
import { errorResponse, requireSameOrigin } from "../../../lib/request";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Announcements (Phase 7, owner 2026-10-26).
 *  GET  — the academy's announcement history, any signed-in role (they are sent to
 *         everyone; expiry only hides the dashboard widget copy).
 *  POST — ADMIN or SUPERVISOR sends one announcement to EVERYONE: the in-app copy +
 *         one WhatsApp job per deduped phone number. The client must echo the
 *         recipient count it showed (explicit confirmation); if the server's count
 *         differs, nothing is sent (409 RECIPIENTS_CHANGED, the new count returned).
 *         There is no PATCH/DELETE: a sent announcement can never be edited (the DB
 *         row is append-only too).
 */
const createSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(2000),
  // Optional end of the in-app widget copy; default = sending time + 3 days.
  expiresAt: z.string().datetime({ offset: true }).optional(),
  confirmRecipientCount: z.number().int().min(0),
});

export async function GET() {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  if (!(await isPhase7Ready())) return NextResponse.json({ data: [] });
  const history = await getAnnouncementHistory(user.academyId);
  return NextResponse.json({ data: history });
}

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  if (!(await isPhase7Ready())) {
    return errorResponse(409, "PHASE7_MIGRATION_PENDING", "Apply migration 20261026170000 first.");
  }
  // Technical safety cap against accidental repeats, counted from ACCEPTED
  // announcements only (owner 2026-10-27): refused attempts (stale count, bad
  // expiry, validation) never use it up. The business frequency rule
  // (ANNOUNCEMENT_MAX_PER_DAY) is enforced per academy inside the transaction below.
  const acceptedLastHour = await prisma.announcement.count({
    where: { academyId: user.academyId, createdById: user.id, sentAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (acceptedLastHour >= ANNOUNCEMENT_MAX_PER_AUTHOR_PER_HOUR) {
    return errorResponse(429, "RATE_LIMITED", "Too many announcements. Try again later.");
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid announcement.", parsed.error.flatten().fieldErrors);
  }

  const now = new Date();
  const expiresAt = parsed.data.expiresAt
    ? new Date(parsed.data.expiresAt)
    : new Date(now.getTime() + ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS * DAY_MS);
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + ANNOUNCEMENT_MAX_EXPIRY_DAYS * DAY_MS) {
    return errorResponse(400, "VALIDATION_ERROR", "The expiry date must be in the future and within 90 days.", {
      expiresAt: [`1–${ANNOUNCEMENT_MAX_EXPIRY_DAYS} days`],
    });
  }

  const recipients = await computeAnnouncementRecipients(user.academyId);
  if (recipients.whatsappRecipients !== parsed.data.confirmRecipientCount) {
    return NextResponse.json(
      {
        error: { code: "RECIPIENTS_CHANGED", message: "The recipient count changed. Review it and confirm again." },
        data: { whatsappRecipients: recipients.whatsappRecipients },
      },
      { status: 409 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    // Frequency rule (owner, 2026-10-26): at most ANNOUNCEMENT_MAX_PER_DAY per
    // academy in any rolling 24 hours. A per-academy advisory lock serialises
    // concurrent sends so two requests cannot both pass the count.
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`announcements:${user.academyId}`}))) AS lock_taken`;
    const sentLastDay = await tx.announcement.count({
      where: { academyId: user.academyId, sentAt: { gt: new Date(now.getTime() - DAY_MS) } },
    });
    if (sentLastDay >= ANNOUNCEMENT_MAX_PER_DAY) return null;
    const announcement = await tx.announcement.create({
      data: {
        academyId: user.academyId,
        createdById: user.id,
        title: parsed.data.title,
        body: parsed.data.body,
        sentAt: now,
        expiresAt,
        whatsappRecipientCount: recipients.whatsappRecipients,
      },
      select: { id: true, sentAt: true, expiresAt: true, whatsappRecipientCount: true },
    });
    if (recipients.recipientUserIds.length) {
      await tx.notificationJob.createMany({
        data: recipients.recipientUserIds.map((recipientUserId) => ({
          academyId: user.academyId,
          sessionId: null,
          recipientUserId,
          kind: "ANNOUNCEMENT",
          dedupKey: `ANNOUNCEMENT:${announcement.id}:${recipientUserId}`,
          scheduledFor: now,
          // Redaction rule: ids only — the text stays in announcements.
          payload: { announcementId: announcement.id },
        })),
        skipDuplicates: true,
      });
    }
    return announcement;
  });
  if (!created) {
    return errorResponse(
      429,
      "ANNOUNCEMENT_DAILY_LIMIT",
      `At most ${ANNOUNCEMENT_MAX_PER_DAY} announcements can be sent in 24 hours. Nothing was sent.`,
    );
  }

  // Redacted summary only: id + count, never the text or any number.
  console.info(`[announcements] ${created.id} queued for ${created.whatsappRecipientCount} WhatsApp recipient(s).`);
  return NextResponse.json({ data: created }, { status: 201 });
}
