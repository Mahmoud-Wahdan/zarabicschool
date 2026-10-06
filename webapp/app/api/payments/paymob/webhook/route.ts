import { NextResponse } from "next/server";

import { PaymobProvider, PaymentProviderError } from "../../../../../lib/payments";
import { settlePaidInvoice } from "../../../../../lib/payments/settlement";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const event = new PaymobProvider().verifyWebhook(rawBody, request.headers.get("hmac"));
    const result = await settlePaidInvoice(event);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}
