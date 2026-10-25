# ZarabicSchool — Session 2 Test Plan (Payment security, billing, subscriptions)

> **STATUS:** TEST PLAN ONLY — **DO NOT RUN AUTOMATED TESTS** until the owner explicitly sends `Run the tests` (same protocol as Session 1 §0).
> **Rules:**
> 1. No dedicated test database — Jest runs against the development PostgreSQL DB with `demo_test_*` records and strict per-test cleanup (CONTEXT §17 / PROGRESS.md 2026-10-03 §5).
> 2. Jest for unit + integration; Playwright for E2E. All commands run from `webapp/`.
> 3. The plan assumes the owner has applied BOTH pending migrations first (`npx prisma migrate status` to verify): `20261018190000_session1_report_languages_monthly` and `20261020000000_phase6b_subscriptions_and_plans` (`npx prisma migrate deploy`, DIRECT_URL).
> 4. `webhook_events` and `notification_jobs` rows created by tests must be cleaned up per test.
> 5. No secrets in fixtures or assertions — Paymob HMAC fixtures derive from a test-only secret held in the test process env, never from `.env`.

---

## 1. Scope (what Session 2 changed — all "implemented, not verified")

- `lib/payments/settlement.ts` — atomic `webhook_events` claim inside the settlement transaction; duplicate events → `already_processed`; `IGNORED` (failed payment) and `UNMATCHED` (no merchant_order_id) recording; redacted allowlisted payloads.
- `app/api/invoices/[id]/checkout/route.ts` — transactional invoice-row claim; deterministic attempt keys `invoice:{id}:v{n}`; URL reuse window (< 50 min); `409 CHECKOUT_IN_PROGRESS` (< 2 min in-flight); stale attempts failed before takeover.
- `app/api/invoices/route.ts` + `lib/validation/financial.ts` — server-side exchange-rate snapshot (client-supplied rate removed).
- `lib/worker/credits.ts` — monthly credit EXPIRY worker (no rollover), idempotent per subscription.
- `/admin/billing` UI + billing APIs (pre-existing, now UI-covered): plans, exchange rates, pay-per-session.
- `__tests__/api/reports.test.ts` — reconciled to submit-time delivery (see test-plan-session1.md; shared here: re-run that suite in the same authorized loop).
- `.env.example` Paymob naming alignment (verification, not a test).

## 2. Integration tests (Jest, real dev DB)

### 2.1 Webhook settlement & event table (`__tests__/api/payments-webhook.test.ts`)

| ID | Scenario | Expected |
|---|---|---|
| INT-WH-01 | Valid signed success event, first delivery | ONE transaction: `webhook_events` row `PROCESSED`, invoice `PAID`, subscription created, exactly ONE `INITIAL_PURCHASE`, paying attempt `SUCCEEDED`. HTTP 200 `settled`. |
| INT-WH-02 | Exact replay of the same event (same `provider_event_id`) | HTTP 200 `already_processed`; NO second subscription, ledger entry, or attempt. |
| INT-WH-03 | Two CONCURRENT identical events (Promise.all) | Exactly one `settled`, the other `already_processed` (or `already_settled` pre-migration); ledger has exactly one `INITIAL_PURCHASE`. |
| INT-WH-04 | Signed event, amount mismatch vs invoice | 400 `INVALID_WEBHOOK` (`Payment does not match the invoice.`); invoice stays PENDING; **no** `webhook_events` row persisted (claim rolled back). |
| INT-WH-05 | Signed non-success event (`success: false`) | 200 `ignored`; `webhook_events` row `IGNORED`; invoice stays PENDING. |
| INT-WH-06 | Signed success event without `merchant_order_id` | 400; `webhook_events` row `UNMATCHED`; nothing settles. |
| INT-WH-07 | Bad HMAC signature | 401 `INVALID_WEBHOOK`; nothing recorded, nothing settled. |
| INT-WH-08 | Ledger insert forced to fail (e.g. drop the funding invoice inside a mocked seam) | Transaction rolls back: `webhook_events` row absent, invoice still PENDING — an event is never marked PROCESSED without its financial effects. |
| INT-WH-09 | Payload redaction | Stored `webhook_events.payload` contains allowlisted keys only — assert `source_data`, `owner`, `pan` are absent. |
| INT-WH-10 | Pre-migration behavior (`isPhase6bReady` mocked false) | Settlement still works via row lock + PAID guard; replay answers `already_settled`; no crash. |

### 2.2 Checkout concurrency (`__tests__/api/invoices-checkout.test.ts`)

| ID | Scenario | Expected |
|---|---|---|
| INT-CO-01 | Single checkout on a PENDING EGP invoice | Attempt `REDIRECTED` with deterministic key `invoice:{id}:v1`; checkout URL returned. |
| INT-CO-02 | Two CONCURRENT POSTs (Promise.all, both authorized) | Exactly ONE `CREATED`/`REDIRECTED` attempt afterwards; the loser gets `409 CHECKOUT_IN_PROGRESS` (or the same URL if it resolved in between). Never two active attempts. |
| INT-CO-03 | Sequential retry after success | Same checkout URL reused (no new attempt) while within the reuse window. |
| INT-CO-04 | In-flight `CREATED` attempt younger than 2 min | `409 CHECKOUT_IN_PROGRESS`; the attempt is NOT failed by the second request. |
| INT-CO-05 | Stale `CREATED` attempt older than 2 min (crashed provider call) | Takeover: old attempts `FAILED`, new attempt created with the NEXT deterministic key; provider called once. |
| INT-CO-06 | Student with a guardian calls checkout | 403 before any attempt is created (finance wall — regression from Session 1, keep asserting). |
| INT-CO-07 | Guardian of the linked child | Permitted; payer name/email come from the guardian. |
| INT-CO-08 | Invoice paid by webhook between claim and provider call | Attempt rows remain honest; no second settlement; replay-safe. |
| INT-CO-09 | USD invoice checkout | `NOT_CONFIGURED` 503; attempt `FAILED`; no provider invented. |

### 2.3 Exchange-rate snapshot (`__tests__/api/invoices-create.test.ts`)

| ID | Scenario | Expected |
|---|---|---|
| INT-RATE-01 | Admin creates a USD invoice with a configured `USD→EGP` rate | Invoice stores the current rate snapshot; a client-sent `exchangeRate` field is ignored (extra field). |
| INT-RATE-02 | No rate configured / migration pending | Snapshot null; invoice created. |
| INT-RATE-03 | Supervisor creates an invoice | 403 (Admin-only). |
| INT-RATE-04 | Rate changed after invoice creation | Existing invoice keeps its stored snapshot. |

### 2.4 Monthly credit EXPIRY worker (`__tests__/worker/credit-expiry.test.ts`)

| ID | Scenario | Expected |
|---|---|---|
| INT-EXP-01 | Ended monthly subscription, balance 3, no reservations | `EXPIRY` entry `sessionsDelta: -3` (funding invoice id linked); status `EXPIRED`. |
| INT-EXP-02 | Re-run the worker on the same subscription | No second `EXPIRY` entry; status unchanged (idempotent). |
| INT-EXP-03 | Ended subscription with 1 RESERVED reservation, balance 2 | `EXPIRY` `-1` (reservation survives); status stays `ACTIVE` until the reservation resolves. |
| INT-EXP-04 | Reservation released after expiry pass | Next pass expires the remainder and finalizes status. |
| INT-EXP-05 | Balance 0, no reservations, period ended | Status `EXHAUSTED`; no `EXPIRY` entry. |
| INT-EXP-06 | PAY_PER_SESSION subscription with "ended" period (null) | Untouched — never expires. |
| INT-EXP-07 | Concurrent worker runs on the same subscription (Promise.all) | Exactly one `EXPIRY` entry total (serializable isolation). |
| INT-EXP-08 | Late settlement after expiry (reservation consumed post-expiry) | Settlement proceeds; balance may go negative; `BALANCE_NEGATIVE` Admin job exists (approved rule). |

### 2.5 Billing route authorization (`__tests__/api/billing-admin.test.ts`)

| ID | Scenario | Expected |
|---|---|---|
| INT-BILL-01 | Supervisor calls plans/exchange-rates/pay-per-session APIs | 403 on every route (Admin-only). |
| INT-BILL-02 | Teacher/Student/Guardian call the same | 401/403. |
| INT-BILL-03 | Plan price update | Existing subscriber keeps the locked price (assert the docs contract at the API level: PATCH affects the plan row only). |
| INT-BILL-04 | Pre-migration (readiness mocked false) | GET returns `migrationPending: true` + empty data; POST/PATCH 409 `MIGRATION_PENDING`; no crash. |

## 3. E2E (Playwright — after the Jest layer is green)

- `e2e/billing/admin-billing.spec.ts`: Admin opens `/ar/admin/billing` (RTL) — migration-pending banner pre-migration, plan creation + deactivation, exchange-rate set, pay-per-session save, localized ar/en. Supervisor navigating to `/en/admin/billing` lands on their own dashboard (proxy + page double guard).
- `e2e/finance/checkout-retry.spec.ts`: adult student opens invoices → Pay now → mock provider redirect URL present; page refresh does not create a second attempt (same URL reused).
- Student-with-guardian finance wall and supervisor money-free dashboards: covered by test-plan-session1.md §5.2/§4.4 — re-run in the same loop.

## 4. Command reference (WHEN AUTHORIZED — never before)

```bash
# from webapp/
npm test -- __tests__/api/payments-webhook.test.ts
npm test -- __tests__/api/invoices-checkout.test.ts
npm test -- __tests__/api/invoices-create.test.ts
npm test -- __tests__/worker/credit-expiry.test.ts
npm test -- __tests__/api/billing-admin.test.ts
npm test -- __tests__/api/reports.test.ts   # reconciled submit-time contract (Session 1 + 2)
npx playwright test e2e/billing/admin-billing.spec.ts e2e/finance/checkout-retry.spec.ts
```
