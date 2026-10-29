// Paymob test double for the E2E checkout specs (test-plan-session2.md §3 "mock
// provider redirect URL"). It answers the three calls lib/payments/paymob.ts makes,
// with Paymob's documented response fields, and serves a placeholder iframe page.
// No card data, no money. Point the app at it with PAYMOB_API_URL=http://127.0.0.1:4010.
import { createServer } from "node:http";

const PORT = Number(process.env.PAYMOB_DOUBLE_PORT ?? 4010);
let nextOrderId = 900000 + Math.floor(Math.random() * 90000);
const orders = [];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/__double/orders") return json(res, 200, orders);
  if (req.method === "GET" && url.pathname.startsWith("/api/acceptance/iframes/")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end("<!doctype html><title>Paymob test checkout</title><h1>Paymob test checkout</h1>");
  }
  if (req.method !== "POST") return json(res, 404, { detail: "Not found" });
  const body = await readJson(req);
  if (!body) return json(res, 400, { detail: "invalid json" });
  if (url.pathname === "/api/auth/tokens") {
    return body.api_key ? json(res, 201, { token: "double-auth-token" }) : json(res, 403, { detail: "api_key" });
  }
  if (url.pathname === "/api/ecommerce/orders") {
    const order = { id: nextOrderId++, amount_cents: body.amount_cents, currency: body.currency, merchant_order_id: body.merchant_order_id };
    orders.push(order);
    return json(res, 201, order);
  }
  if (url.pathname === "/api/acceptance/payment_keys") {
    return json(res, 201, { token: `double-payment-key-${body.order_id}` });
  }
  return json(res, 404, { detail: "Not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`paymob double on http://127.0.0.1:${PORT}`));
