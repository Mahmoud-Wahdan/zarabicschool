import { NextResponse } from "next/server";

import { handleSubscriptionCallback } from "../../../../../lib/billing/renewal";
import { verifySubscriptionCallback } from "../../../../../lib/payments/paymob-subscriptions";
import { PaymentProviderError } from "../../../../../lib/payments/types";

export const runtime = "nodejs";

// Signed server-to-server Paymob subscription callback: no session, no same-origin
// check (B3 exemption, like the transaction webhook). The HMAC covers only the
// trigger and the subscription id, so the body is a TRIGGER: renewals are re-fetched
// from Paymob before any money moves (lib/billing/renewal.ts). 401 bad HMAC, 400
// malformed, 413 too large, 200 with a status for everything signed, 500 only on a
// server fault (Paymob may retry; the sweep is idempotent).
const MAX_BODY_BYTES = 64 * 1024;

function tooLarge() {
  return NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Webhook body is too large." } }, { status: 413 });
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return tooLarge();
  try {
    const event = verifySubscriptionCallback(rawBody);
    const result = await handleSubscriptionCallback(event);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      // A signed renewal trigger whose re-fetch failed (Paymob down) is still a 200:
      // the worker sweep books it later. Unsigned/malformed bodies keep their status.
      if (error.code === "UPSTREAM_ERROR" || error.code === "NOT_CONFIGURED") {
        return NextResponse.json({ status: "deferred" }, { status: 200 });
      }
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    throw error;
  }
}
