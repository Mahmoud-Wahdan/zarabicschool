import { randomUUID } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { expect, messages, test, visit } from "../support/test";

/**
 * WhatsApp through the REAL OpenWA gateway (zarabicschool/OpenWA, started separately —
 * e2e/README.md). No stub: when OpenWA is not reachable these tests skip with that reason.
 * Whether its WhatsApp session is linked to a phone does not change what is asserted: the
 * fixture users carry fictional +1-202-555-01xx numbers, so nothing reaches a person.
 */
const OPENWA_URL = (process.env.OPENWA_URL ?? "").replace(/\/$/, "");
const OPENWA_KEY = process.env.OPENWA_API_KEY ?? "";
const OPENWA_SESSION = process.env.OPENWA_SESSION_ID ?? "";
const t = messages.en.whatsappAdmin;

async function openwa(path: string, init: RequestInit = {}) {
  return fetch(`${OPENWA_URL}/api${path}`, { ...init, headers: { "X-API-Key": OPENWA_KEY, "content-type": "application/json", ...init.headers } });
}

test.beforeAll(async () => {
  const live = OPENWA_URL ? await openwa("/health").then((response) => response.ok).catch(() => false) : false;
  test.skip(!live, `OpenWA is not reachable at ${OPENWA_URL || "(OPENWA_URL unset)"}`);
});

test("the Admin's health check reaches OpenWA (liveness and readiness)", async ({ open }) => {
  const page = await open("admin");
  await visit(page, "/en/admin/whatsapp");
  await page.getByRole("button", { name: t.healthCheck }).click();
  await expect(page.getByText(/ok \(HTTP 200\)/).first()).toBeVisible();
  await expect(page.getByText(t.healthUnreachable)).toHaveCount(0);
});

test("OpenWA's own signed test delivery is accepted by the app's webhook", async () => {
  const hooks = (await (await openwa(`/sessions/${OPENWA_SESSION}/webhooks`)).json()) as { id: string; url: string; active: boolean }[];
  const hook = hooks.find((entry) => entry.url.endsWith("/api/whatsapp/status") && entry.active);
  test.skip(!hook, "no OpenWA webhook registered for /api/whatsapp/status (e2e/README.md)");
  const result = await (await openwa(`/sessions/${OPENWA_SESSION}/webhooks/${hook!.id}/test`, { method: "POST" })).json();
  expect(result).toMatchObject({ success: true, statusCode: 200 });
});

test("an Admin message is queued, then the worker hands it to OpenWA and records the outcome", async ({ open }) => {
  test.setTimeout(240_000);
  const r = run();
  const body = `E2E WhatsApp ${randomUUID().slice(0, 8)}`;
  const page = await open("admin");
  await visit(page, "/en/admin/whatsapp");
  await page.getByLabel(t.messageRecipient).selectOption(r.fixtures.guardianUserId);
  await page.getByLabel(t.messageBody).fill(body);
  await page.getByRole("button", { name: t.messageSend }).click();
  await expect(page.getByText(t.messageQueued)).toBeVisible();

  const [message] = await query<{ id: string }>("SELECT id FROM admin_messages WHERE academy_id = $1 AND body = $2", [r.fixtures.academyId, body]);
  expect(message).toBeDefined();
  const job = () =>
    query<{ status: string; attempts: number; last_error: string | null; payload: Record<string, unknown> }>(
      "SELECT status::text, attempts, last_error, payload FROM notification_jobs WHERE dedup_key = $1",
      [`ADMIN_MESSAGE:${message.id}`],
    );
  // Redaction: the job row carries the message id, never the text.
  expect(JSON.stringify((await job())[0].payload)).not.toContain(body);
  // The worker polls every 60 s.
  await expect.poll(async () => (await job())[0]?.attempts ?? 0, { timeout: 200_000, intervals: [5_000] }).toBeGreaterThan(0);
  const [outcome] = await job();
  test.info().annotations.push({ type: "OpenWA outcome", description: `${outcome.status} — ${outcome.last_error ?? "no error"}` });
  expect(["SENT", "FAILED", "PENDING"]).toContain(outcome.status);
  if (outcome.status !== "SENT") expect(outcome.last_error ?? "").toMatch(/OpenWA/);
});

test("G-WA-1 (new, open): a send while the WhatsApp session is down is retried, not failed for good", async () => {
  const status = await (await openwa(`/sessions/${OPENWA_SESSION}`)).json();
  test.skip(status?.status === "ready", "the OpenWA session is linked and ready, so the down case cannot be observed");
  test.fail(true, "Open finding G-WA-1: with the OpenWA session not started OpenWA answers HTTP 400 ('Session … is not active'), which lib/messaging/openwa-provider.ts treats as permanent, so the job is FAILED after one attempt and the message is lost.");
  const failed = await query<{ attempts: number }>(
    "SELECT attempts FROM notification_jobs WHERE academy_id = $1 AND status = 'FAILED' AND last_error = 'OpenWA returned HTTP 400.'",
    [run().fixtures.academyId],
  );
  expect(failed.length).toBeGreaterThan(0);
  for (const job of failed) expect(job.attempts).toBeGreaterThan(1);
});
