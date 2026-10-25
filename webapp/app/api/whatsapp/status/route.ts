import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { isWhatsAppDeliveryReady } from "../../../../lib/messaging/readiness";
import { prisma } from "../../../../lib/prisma";
import { errorResponse } from "../../../../lib/request";

/**
 * POST /api/whatsapp/status — OpenWA delivery webhook (slice d).
 *
 * No session auth: the caller is OpenWA. Trust comes ONLY from
 * `X-OpenWA-Signature: sha256=<hex HMAC-SHA256 of the exact body>` keyed with
 * OPENWA_WEBHOOK_SECRET. The signature is computed over the RAW body (read with
 * req.text() before any JSON parsing) and compared timing-safe. Missing secret,
 * missing or wrong signature = 401 and nothing is stored.
 *
 * Subscribed events (registered manually, never from app code): message.ack,
 * message.failed, session.status. Payloads carry ids and statuses only; we
 * store ids and statuses only — never message content. Any other event is
 * acknowledged and ignored. Replays are harmless: delivery status only moves
 * forward (SENT → DELIVERED → READ; FAILED never overwrites DELIVERED/READ).
 */
const MAX_BODY_BYTES = 64 * 1024;
const RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };

function signatureValid(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function toDeliveryStatus(value: unknown): "SENT" | "DELIVERED" | "READ" | "FAILED" | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper === "SENT" || upper === "DELIVERED" || upper === "READ" || upper === "FAILED" ? upper : null;
}

export async function POST(request: Request) {
  const secret = process.env.OPENWA_WEBHOOK_SECRET;
  if (!secret) return errorResponse(401, "UNAUTHORIZED", "Webhook signature required.");

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return errorResponse(413, "PAYLOAD_TOO_LARGE", "Payload too large.");
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "Payload too large.");
  }
  if (!signatureValid(rawBody, request.headers.get("x-openwa-signature"), secret)) {
    return errorResponse(401, "UNAUTHORIZED", "Invalid webhook signature.");
  }

  let envelope: { event?: unknown; sessionId?: unknown; data?: Record<string, unknown> } | null = null;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Body is not valid JSON.");
  }
  const event = typeof envelope?.event === "string" ? envelope.event : "";
  const expectedSession = process.env.OPENWA_SESSION_ID;
  if (expectedSession && envelope?.sessionId !== expectedSession) {
    // Signed but for another OpenWA session — acknowledge, store nothing.
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (event === "session.status") {
    // Status word only (e.g. "ready", "disconnected") — no ids, no content.
    const status = typeof envelope?.data?.status === "string" ? envelope.data.status.slice(0, 32) : "unknown";
    console.info(`[whatsapp] OpenWA session status: ${status}`);
    return NextResponse.json({ ok: true });
  }

  if (event !== "message.ack" && event !== "message.failed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const messageId = typeof envelope?.data?.messageId === "string" ? envelope.data.messageId.slice(0, 255) : null;
  const status = event === "message.failed" ? "FAILED" : toDeliveryStatus(envelope?.data?.status);
  if (!messageId || !status) return NextResponse.json({ ok: true, ignored: true });

  // Pre-migration the columns do not exist yet: acknowledge so OpenWA does not
  // keep retrying, store nothing (self-heals once the owner applies it).
  if (!(await isWhatsAppDeliveryReady())) return NextResponse.json({ ok: true, ignored: true });

  // Forward-only, conditional update (concurrent/replayed deliveries are no-ops).
  const lowerStatuses =
    status === "FAILED"
      ? ["SENT"]
      : Object.keys(RANK).filter((key) => RANK[key] < RANK[status]).concat(status === "SENT" ? [] : ["FAILED"]);
  await prisma.notificationJob.updateMany({
    where: {
      providerMessageId: messageId,
      OR: [{ deliveryStatus: null }, { deliveryStatus: { in: lowerStatuses } }],
    },
    data: { deliveryStatus: status, deliveryUpdatedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
