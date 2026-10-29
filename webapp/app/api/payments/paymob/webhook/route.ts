import { NextResponse } from "next/server";

import { PaymobProvider, PaymentProviderError } from "../../../../../lib/payments";
import { PaymobSignedShapeError, readPaymobSignature } from "../../../../../lib/payments/paymob";
import { recordInvalidSignedEvent, settlePaidInvoice } from "../../../../../lib/payments/settlement";
<<<<<<< HEAD
import { activateSignup } from "../../../../../lib/billing/renewal";
=======
>>>>>>> a36b92a5884fce32fbf1247ff19460553cbdf488

export const runtime = "nodejs";

// Signed server-to-server callback: no session, no same-origin check (B3 exemption).
// 401 bad/missing HMAC (nothing stored), 400 malformed signed body, 200 with a status
// for everything signed (settled / already_processed / ignored / unmatched /
// mismatch / already_settled / not_payable), 500 only on a DB fault (provider retries).
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
    const event = new PaymobProvider().verifyWebhook(rawBody, readPaymobSignature(request.url, request.headers));
    const result = await settlePaidInvoice(event);
    if (result.status === "settled") {
      // D55: a settled month-1 invoice of an automatic-renewal sign-up activates it.
      // Never changes the webhook answer; the worker retries a failed activation.
      try {
        await activateSignup(result.invoiceId, event.providerReference);
      } catch {
        console.error(`[webhook] renewal sign-up activation deferred for invoice ${result.invoiceId}.`);
      }
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof PaymobSignedShapeError) {
      // Field names only (never values) — the shape is unconfirmed until the sandbox run.
      console.warn(`[webhook] signed Paymob callback with unexpected fields: ${error.fieldNames.join(", ")}`);
      await recordInvalidSignedEvent("PAYMOB", error.rawEventHash, error.fieldNames);
      return NextResponse.json({ status: "invalid_shape" }, { status: 200 });
    }
    if (error instanceof PaymentProviderError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}
