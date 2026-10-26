import { prisma } from "../../lib/prisma";

/**
 * webhook_events has no academy_id, and A1 builds provider_event_id from the
 * HMAC-covered numeric Paymob transaction id ("<txn>", "<txn>:<OUTCOME>",
 * "<txn>:UNMATCHED", or "invalid:<sha256 of the raw body>"), so a demo_test_ prefix
 * is impossible. Tests therefore TRACK every id they can create and cleanup deletes
 * exactly those rows — never a pattern that could match a real event.
 *
 * Test transaction/order ids are 18-digit strings starting with 9 (JSON strings —
 * a number this long would lose precision), far outside real Paymob ids.
 */
const trackedTransactionIds = new Set<string>();
const trackedRawHashes = new Set<string>();
let counter = 0;

export function testPaymobId(): string {
  counter += 1;
  const id = `9${Date.now().toString().padStart(13, "0")}${String(counter).padStart(4, "0")}`;
  trackedTransactionIds.add(id);
  return id;
}

export function trackInvalidShapeHash(rawEventHash: string) {
  trackedRawHashes.add(rawEventHash);
}

export async function cleanupTrackedWebhookEvents() {
  const ids = [...trackedTransactionIds];
  const exact = [...ids, ...[...trackedRawHashes].map((hash) => `invalid:${hash}`)];
  const outcomeIds = ids.flatMap((id) =>
    ["FAILED", "PENDING", "VOIDED", "REFUNDED", "UNMATCHED"].map((suffix) => `${id}:${suffix}`),
  );
  if (!exact.length) return 0;
  const result = await prisma.webhookEvent.deleteMany({
    where: { provider: "PAYMOB", providerEventId: { in: [...exact, ...outcomeIds] } },
  });
  return result.count;
}
