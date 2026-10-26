import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "../../../../lib/dal";
import { isWhatsAppDeliveryReady } from "../../../../lib/messaging/readiness";
import { prisma } from "../../../../lib/prisma";
import { allowRequest } from "../../../../lib/rate-limit";
import { errorResponse, requireSameOrigin } from "../../../../lib/request";

/**
 * POST /api/admin/messages — Admin individual WhatsApp message (slice d).
 *
 * ADMIN only (a Supervisor gets 403). The body is stored ONLY in admin_messages;
 * the notification job carries `{ adminMessageId }` and nothing else, the body is
 * never logged and this route never echoes it back. Delivery goes through the
 * normal worker (retry, spacing, delivery tracking).
 */
const bodySchema = z.object({
  recipientUserId: z.guid(),
  body: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const { user, error } = await requireApiRole("ADMIN");
  if (error) return error;
  if (!(await isWhatsAppDeliveryReady())) {
    return errorResponse(409, "WHATSAPP_MIGRATION_PENDING", "Apply migration 20261026000000 first.");
  }
  // Small per-Admin cap: WhatsApp via an unofficial gateway can get the number banned.
  if (!allowRequest(`admin-message:${user.id}`, 20, 10 * 60 * 1000)) {
    return errorResponse(429, "RATE_LIMITED", "Too many messages. Try again later.");
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid message.", parsed.error.flatten().fieldErrors);
  }

  const recipient = await prisma.user.findFirst({
    where: { id: parsed.data.recipientUserId, academyId: user.academyId, isActive: true },
    select: { id: true, phone: true },
  });
  if (!recipient) return errorResponse(404, "NOT_FOUND", "Recipient not found.");
  if (!recipient.phone) return errorResponse(409, "RECIPIENT_NO_PHONE", "Recipient has no phone number.");

  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.adminMessage.create({
      data: {
        academyId: user.academyId,
        recipientUserId: recipient.id,
        createdById: user.id,
        body: parsed.data.body,
      },
      select: { id: true, createdAt: true },
    });
    const job = await tx.notificationJob.create({
      data: {
        academyId: user.academyId,
        sessionId: null,
        recipientUserId: recipient.id,
        kind: "ADMIN_MESSAGE",
        dedupKey: `ADMIN_MESSAGE:${message.id}`,
        scheduledFor: new Date(),
        // Redaction rule: ids only — the body stays in admin_messages.
        payload: { adminMessageId: message.id },
      },
      select: { id: true },
    });
    return { messageId: message.id, jobId: job.id, createdAt: message.createdAt };
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
