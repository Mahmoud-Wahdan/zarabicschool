# Phase 6 â€” Financial Management

## Goal

Hosted payment gateways (Paymob for EGP plus an unconfigured USD provider boundary) + automatic teacher payroll accrual (Section 7). (CONTEXT.md Â§13, Phase 6.)

Implement student billing with Supabase Storage proof uploads, the dual-ledger accounting architecture (`SubscriptionLedger` + `PayrollLedger`), multi-currency balance tracking, and approval-gated report settlement. BullMQ/Zoom reconciliation is not part of this phase.

## Proposed approach

1. **Database Migrations:**
   - Add `Subscriptions`, `SubscriptionLedger`, `Invoices`, `PaymentProofs`, and `PayrollLedger` to Prisma schema.
   - Enforce database-level uniqueness on payroll session credits:
     ```sql
     CREATE UNIQUE INDEX idx_payroll_ledger_unique_session_credit
     ON payroll_ledger (session_id)
     WHERE entry_type = 'SESSION_CREDIT';
     ```
2. **Student Billing & Gateway Settlement:**
   - Invoices use integer minor units, ISO currency codes, package metadata, and an exchange-rate snapshot.
   - EGP invoices use Paymob hosted checkout; the signed webhook, not the browser return, is authoritative.
   - USD uses the provider interface but remains unavailable until a concrete provider is configured; no fake success path exists.
   - A verified webhook atomically marks the invoice paid, creates the package subscription, and inserts the `INITIAL_PURCHASE` row (+N sessions) into `SubscriptionLedger`.
   - Manual proof uploads, if retained as a fallback, reuse the same invoice state transition and never bypass verification.
3. **Dual-Ledger Financial Engine:**
   - **`SubscriptionLedger`:** Remaining student balance is calculated from append-only rows (`INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND`).
   - **`PayrollLedger`:** Append-only teacher compensation ledger. Stores scheduled `minutes_credited` and `hourly_rate_snapshot_minor`. `created_by = NULL` for system entries, `NOT NULL` for Admin manual adjustments.
4. **Approval-gated atomic settlement:**
   - After Admin or Supervisor approves an attended report, record one `SESSION_DEDUCTION` for that student and one first `SESSION_CREDIT` for the session. Submission alone records no money.
   - Use scheduled duration and the rate snapshot; later reports cannot create another session credit.
   - The same transaction sets `Reports.settled_at` and `Reports.archived_at`.
   - Any failure rolls back both ledger effects and report markers; retry is safe through idempotency constraints.
   - Missed sessions have **0 financial effect**. Replacement sessions trigger this transaction when completed. Overtime beyond scheduled duration is noted in teacher's report and credited by Admin via `ADMIN_ADJUSTMENT`.
5. **Multi-Currency & Teacher Balance Tracking:**
   - No automatic currency conversion in MVP.
   - Teacher dashboards show accrued earnings categorized by currency (e.g. USD balance, EGP balance).
   - Admin manages manual currency conversion and logs payout disbursements (`DISBURSEMENT`).
6. **Consistency:** Query for approved/archived reports without ledger rows and ledger rows without a settled report. Low-balance alerts are deferred.

Delivery stage: Stage 3 â€” In Progress.

## Acceptance criteria

- Approved-report settlement atomically writes one deduction, one first-session credit, `Reports.settled_at`, and `Reports.archived_at`; duplicate/concurrent requests are safe.
- Teacher credit never fails because a package is empty; Admin is flagged for negative balance.

## Frontend

Routes: `/student/invoices`, `/guardian/invoices`, `/admin/invoices`, `/teacher/payroll`, `/admin/payroll`, `/admin/overtime`. Include upload/loading/empty/error states, per-currency balances, mobile RTL, and role visibility.

## Backend

POST `/api/invoices/:id/checkout`, POST `/api/payments/paymob/webhook`, POST `/api/invoices/:id/confirm` (fallback), POST `/api/reports/:id/settle`, POST `/api/payroll/adjustments`, POST `/api/payroll/disbursements`, POST `/api/reports/:id/overtime/approve`. Zod schemas, signed webhook verification, idempotency, consistent errors, conditional overtime claim, and post-commit notifications.

## Database

Touches `Subscriptions`, both ledgers, `Invoices`, `PaymentProofs`, `Reports`, and recommended `TeacherRates`. Partial indexes, checks, append-only triggers, and `ON DELETE RESTRICT` require raw SQL migrations.

## Auth & Authorization

| Role | Upload proof | Confirm invoice | Submit settlement | Approve overtime | View payroll |
|---|---:|---:|---:|---:|---:|
| Student/Guardian | Own | No | No | No | Own permitted view |
| Teacher | No | No | Own report | No | Own |
| Supervisor | No | No | Review/approve report only; no amounts | No | No payroll/money |
| Admin | All | Yes | Review | Yes | All |

## Security

Use integer minor units, currency validation, private uploads, signed URLs, append-only ledgers, server authorization, idempotency, no sensitive logs, and rate limits.

## Transactions & failure handling

Invoice confirmation, approved-report settlement, and overtime approval are transactions. Unique violations return `already_submitted` or `already_settled`; any second-write failure rolls back all writes. `PayrollLedger` is the authoritative teacher balance source and `SubscriptionLedger` is the authoritative session-consumption source.

## Tests

Real-Postgres tests: double submit, concurrent submit, unassigned teacher, before-end report, frozen money edit, second-ledger rollback, group two students/one credit, absent no money, empty package, duplicate overtime approval, and currency handling. Playwright covers invoice/payroll flows.

## Learning checkpoint

- Why do the report claim and unique ledger indexes both matter?
- What does rollback guarantee when the second ledger insert fails?

## Open decisions

TeacherRates storage, rounding, zero-session mechanism, `amount_minor`, integer width, reversal flow, and payout cycle are OPEN/BLOCKED where applicable.

## Deferred / Post-MVP

- [DEFERRED] Low-balance alerts, Zoom reconciliation, and overlap-based billing. Payment gateways are in MVP scope per CONTEXT.md Â§20.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [ ] Add Prisma schema: `Subscriptions`, `SubscriptionLedger`, `Invoices`, `PaymentProofs`, `PayrollLedger`
- [ ] Configure PostgreSQL unique partial index on `PayrollLedger (session_id)` for `SESSION_CREDIT`
- [ ] Run migrations
- [ ] Set up private Supabase Storage bucket for payment proofs & signed URL generator
- [ ] Build student/guardian invoice payment proof upload form
- [ ] Build Admin invoice verification and confirmation workflow (`INITIAL_PURCHASE` credit)
- [ ] Implement Admin/Supervisor approval-gated settlement processor (deduction + first credit + attendance + report markers in one transaction; Supervisor never receives amounts)
- [ ] Build multi-currency teacher earnings breakdown UI (per-currency balances)
- [ ] Build Admin payroll review, manual adjustment, and disbursement approval views
- [ ] REMOVED â€” BullMQ scheduled Zoom reconciliation worker.
- [ ] [DEFERRED] Implement 75% usage low-balance alert trigger via WhatsApp (OpenWA); keep the balance calculation available for Admin review.
- [ ] Write tests: transaction atomicity, double-spend prevention, dual-ledger balance calculations, idempotent replay rejection

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED â€” Zoom reconciliation, event processing, overlap-based billing, and `Sessions.financially_settled_at`.
- [MVP] Only an approved report can settle; successful settlement archives the original immutable report.
- BLOCKED â€” TeacherRates storage, rounding, and the zero-session scheduling mechanism remain owner decisions.

### 2026-10-06 implementation slice

- [MVP] Added the Paymob EGP provider boundary with hosted checkout, HMAC webhook verification, and an explicit unconfigured USD provider boundary.
- [MVP] Added invoice checkout and Paymob webhook routes; verified paid events create the subscription and `INITIAL_PURCHASE` ledger entry atomically and idempotently.
- [MVP] Added replay/signature/provider tests. Database migration and execution remain blocked until the owner confirms the development database and secret rotation.
- [VERIFIED] Reviewed the current payment implementation and ran `npm run typecheck`, `npm run lint`, `npx prisma validate`, `npm run build`, and the focused Paymob Jest suite (3/3) from `webapp`.
- [OPEN] Reports, SessionStudents attendance settlement, PayrollLedger, TeacherRates, invoice UI, raw SQL ledger constraints/triggers, and real-Postgres transaction tests remain before Phase 6 can be marked complete.

### 2026-10-18 â€” Verification complete

- `npm test` 16 suites / 192 tests green â€” including the new direct-seam settlement tests (NO_TEACHER_RATE refusal with zero money rows; attended settlement = deduction + first credit + markers + consumed reservation; absent settlement = released reservation + zero money), the approval-route settlement integration, and the outage-request matrix (SESSION vs STUDENT scope, replacement jobs, concurrent approval race).
- `prisma migrate status`: 15 migrations, up to date (phase6_financials applied to the dev DB).
- typecheck / lint / build clean. Demo seed re-run: 5 teacher rates, 14 session credits, 1 bonus, 1 payout (existence-guarded; append-only trigger untouched).
- Remaining owner steps: add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ private bucket) to enable attachment/proof uploads; create an EGP Paymob test-mode integration and fill the `PAYMOB_*` env names; USD gateway decision (Dodo vs Xpay) still open; Playwright E2E (`npx playwright test`) needs a dev server + credentials.

### 2026-10-18 â€” Implementation executed

- **Schema + migration `20261018000000_phase6_financials` (APPLIED to the dev DB, additive only):** `teacher_rates`, `payroll_ledger`, `payment_proofs`; enums `PayrollLedgerEntryType`/`PaymentProofStatus`; partial unique `payroll_ledger(session_id) WHERE entry_type='SESSION_CREDIT'`; sign CHECKs (credit > 0, adjustment â‰  0, disbursement < 0), credit-snapshot CHECK (minutes + rate), manual-reason + creator CHECKs (system rows = SESSION_CREDIT with `created_by NULL`), proof review-state CHECK; append-only trigger reusing `prevent_ledger_mutation()`; RESTRICT FKs. The `(session_id, subscription_id) WHERE 'SESSION_DEDUCTION'` partial unique already existed (phase3_integrity).
- **Settlement (fills the Phase 5 seam, same approval transaction):** `lib/payroll/rates.ts` (`creditAmountMinor` integer half-up, `getRateForSession` effective-dated, `SettlementError`), `lib/reports/settlement-seam.ts` (ATTENDED â†’ consume reservation + one deduction + negative-balance ADMIN flag (deduped notification, no amounts) + one first credit with rate snapshot + settled/archived markers; STUDENT_ABSENT â†’ release reservation + zero money + markers; missing rate â†’ `NO_TEACHER_RATE` rolls the whole approval back â€” no invented rates). Review route passes academy/teacher ids and maps `SettlementError` to its coded response.
- **APIs:** `POST /api/reports/[id]/overtime` (Admin; PENDING-only conditional update; approval writes ONE `ADMIN_ADJUSTMENT` at the same per-minute rate â€” never re-settles; post-commit teacher notice without amounts), `GET/POST /api/admin/teacher-rates` (Admin), `POST /api/payroll/adjustments` + `POST /api/payroll/disbursements` (Admin; reason required; `created_by` audit; disbursement recorded negative â€” an internal record, not proof of transfer), `POST /api/invoices` (Admin creates PENDING), `POST /api/invoices/[id]/confirm` (Admin; same atomic transition as the webhook via `settleInvoiceConfirmedByAdmin` â€” PAID + subscription + `INITIAL_PURCHASE` + attempt upsert `manual:{id}`; already-paid = clean `already_settled`), `POST /api/invoices/[id]/proofs` (payer-only: STUDENT adult-without-guardian or GUARDIAN of the child; magic bytes + 10 MB 413; private bucket; PENDING proof; rate-limited), `POST /api/invoices/[id]/proofs/[proofId]` (Admin CONFIRM/REJECT with note; decided proofs final).
- **Pages:** `/student/invoices` (adult-without-guardian gate; Pay now â†’ hosted checkout redirect; proof upload; history), `/guardian/invoices` (per-child), `/admin/invoices` (create/confirm/proof review), `/teacher/payroll` (per-currency balances + pending-approval estimate + ledger), `/admin/payroll` (balances, rates, adjustments, payouts, consistency checks), `/admin/overtime` (queue). Nav links added for admin/teacher/guardian/student; supervisor nav and pages remain money-free (ADMIN-only gates server-side).
- **Worker:** `BALANCE_NEGATIVE` (Admin-only, no amounts) and `OVERTIME_DECISION` (teacher, no amounts) templates.
- **Seed:** teacher rates + 14 SESSION_CREDIT rows for the settled history + one bonus + one payout (all idempotent via existence checks â€” the append-only trigger is never disabled for payroll).
- **Verified:** `prisma validate` valid; typecheck clean; lint clean; migration applied (`migrate status` = 15 migrations, up to date); demo seed re-run populated payroll demo data.

### 2026-10-18 â€” Phase 6 implementation plan (owner-approved mission)

Existing and reused as-is: `Subscriptions`, `SubscriptionLedger`, `Invoices`, `PaymentAttempt` (append-only-safe), Paymob provider + HMAC webhook + `settlePaidInvoice` (row lock + paid-state idempotency), USD `NOT_CONFIGURED` boundary, Supervisor no-money routing.

Build order:
1. **Schema + migration `phase6_financials` (OWNER APPLIES):** `teacher_rates` (effective-dated; `hourly_rate_minor INTEGER`, ISO currency, `effective_from`, `created_by`), `payroll_ledger` (append-only trigger; `entry_type âˆˆ {SESSION_CREDIT, ADMIN_ADJUSTMENT, DISBURSEMENT}`; `amount_minor INTEGER`; `minutes_credited` + `hourly_rate_snapshot_minor` on credits; `created_by NULL` for system rows), `payment_proofs` (private-storage `file_path`, status PENDING/CONFIRMED/REJECTED, reviewer metadata). Raw SQL: partial unique `payroll_ledger(session_id) WHERE entry_type='SESSION_CREDIT'`; partial unique `subscription_ledger(session_id, subscription_id) WHERE entry_type='SESSION_DEDUCTION'`; append-only trigger on `payroll_ledger`; RESTRICT FKs.
2. **Settlement (`lib/reports/settlement.ts` fills the Phase 5 seam, same approval transaction):** ATTENDED â†’ consume the (session, student) reservation, one `SESSION_DEDUCTION` (âˆ’1; P2002 = already done), one `SESSION_CREDIT` (rate = `teacher_rates` row with `effective_from <= scheduled_start`; missing rate â†’ typed `NO_TEACHER_RATE` error that rolls the approval back â€” no invented rates), `settled_at` + `archived_at`, negative post-deduction balance â†’ admin flag notification (deduped). STUDENT_ABSENT â†’ release the reservation, zero money, `settled_at` + `archived_at` still set. Replacement sessions settle identically. Overtime never re-settles: separate Admin approval writes an `ADMIN_ADJUSTMENT` at the same per-minute rate.
3. **Payroll surfaces:** `POST /api/reports/[id]/overtime` (Admin; PENDING-only, idempotent), `GET/POST /api/admin/teacher-rates` (Admin), `POST /api/payroll/adjustments` + `POST /api/payroll/disbursements` (Admin, reason required, `created_by` audit). Pages: `/teacher/payroll` (per-currency earnings + ledger), `/admin/payroll` (balances per currency, adjustments, disbursements, consistency checks), `/admin/overtime` (queue). Supervisor never receives amounts (no routes, no data).
4. **Billing:** `POST /api/invoices` (Admin creates a PENDING invoice; amount from Admin input, never client-side at pay time), `POST /api/invoices/[id]/confirm` (Admin manual confirmation â†’ the same atomic transition as the webhook: PAID + subscription + `INITIAL_PURCHASE`), `POST /api/invoices/[id]/proofs` (owner upload: magic-bytes allowlist, 10 MB, private bucket, PENDING proof), `POST /api/payment-proofs/[id]` (Admin confirm/reject with note). Pages: `/student/invoices`, `/guardian/invoices` (list, detail, pay via Paymob checkout, proof upload, history), `/admin/invoices` (create/confirm/proofs). Browser redirect is never authoritative; only the signed webhook or an explicit Admin confirmation moves money.
5. **Consistency checks** on `/admin/payroll`: approved/archived ATTENDED reports without a credit; ledger rows without a settled report; deductions without a settled report.

Owner decisions already locked (CONTEXT Â§7.9) are applied: INTEGER minor units, half-up rounding, one currency per teacher, reversal = Admin-only reversing entries (out of this batch unless trivially reachable), grace 3 days, min 1 / max 16 pay-per-session.

### 2026-10-20 — Phase 6b + payment-security pass (Session 2, "implement first, test after")

Implemented on `feature/phase-5` (HEAD 93e27a7 + this pass), reported **implemented, not verified**. Automated tests were NOT run (owner authorizes separately). Migrations were NOT applied.

- **Webhook atomicity/idempotency (B1):** `lib/payments/settlement.ts` now claims the event FIRST inside the settlement transaction (`webhook_events`, `UNIQUE(provider, provider_event_id)`) — the claim, the invoice `PAID` transition, the subscription, the `INITIAL_PURCHASE` ledger entry, and the payment-attempt upsert commit or roll back TOGETHER; a duplicate/concurrent delivery of the same event answers `already_processed` (P2002 caught inside the transaction). Signed non-success events are recorded as `IGNORED` and events without `merchant_order_id` as `UNMATCHED` (both redacted, best-effort, never change the webhook outcome). Payloads are stored through an allowlist ONLY (identification + outcome; card `source_data`, `owner`, customer fields never persisted). Before migration `20261020000000_phase6b_subscriptions_and_plans` is applied, `isPhase6bReady()` keeps the previous behavior (invoice row lock + PAID-state guard as the duplicate protection) — no crash.
- **Checkout concurrency (B2):** `POST /api/invoices/[id]/checkout` claims the invoice row (`FOR UPDATE`) in ONE transaction before calling the provider: concurrent POSTs serialize, at most one active attempt exists per invoice, the idempotency key is deterministic (`invoice:{id}:v{attemptNumber}` — never a timestamp), a fresh `REDIRECTED` attempt's URL is reused (< 50 min, inside Paymob's 3600 s payment-key expiry), an in-flight `CREATED` attempt (< 2 min) answers `409 CHECKOUT_IN_PROGRESS`, and stale/unusable attempts are failed before a takeover. The finance wall and ownership checks are unchanged.
- **Paymob env names (B3):** verified the implementation reads exactly `PAYMOB_API_URL`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_EGP`, `PAYMOB_IFRAME_ID_EGP`, `PAYMOB_HMAC_SECRET`; `.env.example` now lists these (unused `PAYMOB_PUBLICKEY`/`PAYMOB_SECRETKEY`/`PAYMOB_HMAC`/`PAYMOB_INTEGRATION_ID` removed from the example); CONTEXT §17 records the verification.
- **Exchange-rate snapshot (B4):** `POST /api/invoices` no longer accepts a client-supplied rate — the snapshot is selected server-side from the academy's `ExchangeRates` (invoice currency ? EGP, the demo-seed convention) at creation; EGP invoices and pre-migration states store null, exactly like the old optional-field behavior. Historical invoices keep their stored snapshot.
- **Monthly credit EXPIRY worker (B5, feasible part):** `lib/worker/credits.ts` (`processMonthlyCreditExpiry`, wired into the worker tick) writes the approved `EXPIRY` ledger entries at period end for unused monthly-plan (and annual monthly-window) credits — no rollover. Idempotent per subscription via ONE serializable transaction (row re-read under lock, expirable amount recomputed inside), reservations for not-yet-settled sessions survive period end, terminal status (`EXPIRED`/`EXHAUSTED`) finalizes exactly once from `ACTIVE`. A late settlement after expiry may drive the balance negative — the existing approved rule applies (settle + flag Admin).
- **Billing UI (B7):** Admin-only `/admin/billing` page + `AdminBillingPanel` (create/activate/deactivate/re-price plans, set exchange rates, pay-per-session min/max) on the existing Admin billing APIs; localized (ar/en), migration-pending degraded banner names the exact migration; nav item added to the ADMIN shell only; USD checkout still answers `NOT_CONFIGURED` — the page never implies a configured USD provider.
- **Test reconciliation (A1):** `__tests__/api/reports.test.ts` updated to the submit-time delivery contract (family `REPORT_SUBMITTED` jobs on submit, guardians AND students per visibility; approval enqueues nothing to the family; the failed-notice test now exercises a failed SUBMIT notice not rolling back the submission). Stale `MESSAGING_PROVIDER="fake"` setup line removed. NOT RUN — executes only with the owner's `Run the tests`.
- **BLOCKED — owner decision/provider contract required (unchanged by this pass):** annual-plan monthly credit grants (ledger entry type for grant-without-invoice + annual-term tracking are not defined by the approved docs; `BillingSubscription` is not populated by any flow yet); provider-managed renewal webhook parsing (Paymob subscription/renewal webhook contract is not in the repo — normalized `VerifiedPaymentEvent` seam kept, no invented fields); failed-renewal grace (depends on `BillingSubscription` lifecycle); USD gateway choice (Dodo vs Xpay — CONTEXT §17 conflict row, do not decide in code).
- **Pending migrations (OWNER APPLIES from `webapp/`, DIRECT_URL — verify with `npx prisma migrate status` first):** `20261018190000_session1_report_languages_monthly` (Session 1) and `20261020000000_phase6b_subscriptions_and_plans` (Phase 6b) — both additive; the code self-heals until they land.
- **Owner step (Paymob dashboard configuration — added 2026-10-20):** once the EGP test-mode integration exists, the owner must also configure Paymob to deliver transaction webhooks to `https://<your-host>/api/payments/paymob/webhook` (POST; the route reads the `hmac` header) and set the SAME secret in the `PAYMOB_HMAC_SECRET` env name — the server rejects unsigned/mismatched events with 401/400 and records nothing. The other required env names are exactly `PAYMOB_API_URL`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_EGP`, `PAYMOB_IFRAME_ID_EGP` (names only — never values in docs or Git).
