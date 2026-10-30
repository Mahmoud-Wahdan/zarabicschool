import { randomUUID } from "node:crypto";

import { query } from "../support/db";
import { run } from "../support/run";
import { expect, messages, test, visit } from "../support/test";

/**
 * WhatsApp through the REAL OpenWA gateway (zarabicschool/OpenWA, started by
 * playwright.config.ts with the run). No stub and no skip (owner, 2026-10-31): when
 * OpenWA is not reachable these tests FAIL with that reason. A linked phone is not
 * needed: the fixture users carry fictional +1-202-555-01xx numbers, so nothing
 * reaches a person, and the session-down case is produced by stopping the session.
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
  expect(live, `OpenWA must be reachable at ${OPENWA_URL || "(OPENWA_URL unset)"} (started by playwright.config.ts; E2E_WHATSAPP=off cannot run this spec)`).toBe(true);
});

/** The app's delivery webhook in OpenWA, registered for this run when it is missing. */
async function statusWebhook() {
  const target = `${new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin}/api/whatsapp/status`;
  const hooks = (await (await openwa(`/sessions/${OPENWA_SESSION}/webhooks`)).json()) as { id: string; url: string; active: boolean }[];
  const existing = hooks.find((entry) => entry.url === target && entry.active);
  if (existing) return existing;
  const secret = process.env.OPENWA_WEBHOOK_SECRET ?? "";
  expect(secret.length, "OPENWA_WEBHOOK_SECRET must be set in .env (16+ characters)").toBeGreaterThanOrEqual(16);
  const created = await openwa(`/sessions/${OPENWA_SESSION}/webhooks`, { method: "POST", body: JSON.stringify({ url: target, events: ["*"], secret }) });
  expect(created.status, await created.clone().text()).toBeLessThan(300);
  return (await created.json()) as { id: string; url: string; active: boolean };
}

test("the Admin's health check reaches OpenWA (liveness and readiness)", async ({ open }) => {
  const page = await open("admin");
  await visit(page, "/en/admin/whatsapp");
  await page.getByRole("button", { name: t.healthCheck }).click();
  await expect(page.getByText(/ok \(HTTP 200\)/).first()).toBeVisible();
  await expect(page.getByText(t.healthUnreachable)).toHaveCount(0);
});

test("OpenWA's own signed test delivery is accepted by the app's webhook", async () => {
  const hook = await statusWebhook();
  const result = await (await openwa(`/sessions/${OPENWA_SESSION}/webhooks/${hook.id}/test`, { method: "POST" })).json();
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

test("G-WA-1 (fixed 2026-10-31): a send while the WhatsApp session is down is retried, not failed for good", async ({ api }) => {
  test.setTimeout(240_000);
  // Produce the down case: stop the session if it happens to be running.
  const status = await (await openwa(`/sessions/${OPENWA_SESSION}`)).json();
  if (status?.status === "ready") await openwa(`/sessions/${OPENWA_SESSION}/stop`, { method: "POST" });
  const r = run();
  const admin = await api("admin");
  const body = `E2E session down ${randomUUID().slice(0, 8)}`;
  const sent = await admin.post("/api/admin/messages", { data: { recipientUserId: r.fixtures.guardianUserId, body } });
  expect(sent.status(), await sent.text()).toBeLessThan(300);
  const [message] = await query<{ id: string }>("SELECT id FROM admin_messages WHERE academy_id = $1 AND body = $2", [r.fixtures.academyId, body]);
  const job = () =>
    query<{ status: string; attempts: number; last_error: string | null; scheduled_for: Date }>(
      "SELECT status::text, attempts, last_error, scheduled_for FROM notification_jobs WHERE dedup_key = $1",
      [`ADMIN_MESSAGE:${message.id}`],
    );
  // The worker polls every 60 s.
  await expect.poll(async () => (await job())[0]?.attempts ?? 0, { timeout: 200_000, intervals: [5_000] }).toBeGreaterThan(0);
  const [outcome] = await job();
  // Kept for a later attempt, never FAILED for good.
  expect(outcome.status).toBe("PENDING");
  expect(outcome.last_error).toBe("OpenWA session is not active (HTTP 400).");
  expect(new Date(outcome.scheduled_for).getTime()).toBeGreaterThan(Date.now());
});
