# Phase 6 — Financial Management

## Goal

Hosted payment gateways (Paymob for EGP plus an unconfigured USD provider boundary) + automatic teacher payroll accrual (Section 7). (CONTEXT.md §13, Phase 6.)

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

Delivery stage: Stage 3 — In Progress.

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

- [DEFERRED] Low-balance alerts, Zoom reconciliation, and overlap-based billing. Payment gateways are in MVP scope per CONTEXT.md §20.

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
- [ ] REMOVED — BullMQ scheduled Zoom reconciliation worker.
- [ ] [DEFERRED] Implement 75% usage low-balance alert trigger via WhatsApp (OpenWA); keep the balance calculation available for Admin review.
- [ ] Write tests: transaction atomicity, double-spend prevention, dual-ledger balance calculations, idempotent replay rejection

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom reconciliation, event processing, overlap-based billing, and `Sessions.financially_settled_at`.
- [MVP] Only an approved report can settle; successful settlement archives the original immutable report.
- BLOCKED — TeacherRates storage, rounding, and the zero-session scheduling mechanism remain owner decisions.

### 2026-10-06 implementation slice

- [MVP] Added the Paymob EGP provider boundary with hosted checkout, HMAC webhook verification, and an explicit unconfigured USD provider boundary.
- [MVP] Added invoice checkout and Paymob webhook routes; verified paid events create the subscription and `INITIAL_PURCHASE` ledger entry atomically and idempotently.
- [MVP] Added replay/signature/provider tests. Database migration and execution remain blocked until the owner confirms the development database and secret rotation.
- [VERIFIED] Reviewed the current payment implementation and ran `npm run typecheck`, `npm run lint`, `npx prisma validate`, `npm run build`, and the focused Paymob Jest suite (3/3) from `webapp`.
- [OPEN] Reports, SessionStudents attendance settlement, PayrollLedger, TeacherRates, invoice UI, raw SQL ledger constraints/triggers, and real-Postgres transaction tests remain before Phase 6 can be marked complete.

### 2026-10-18 — Verification complete

- `npm test` 16 suites / 192 tests green — including the new direct-seam settlement tests (NO_TEACHER_RATE refusal with zero money rows; attended settlement = deduction + first credit + markers + consumed reservation; absent settlement = released reservation + zero money), the approval-route settlement integration, and the outage-request matrix (SESSION vs STUDENT scope, replacement jobs, concurrent approval race).
- `prisma migrate status`: 15 migrations, up to date (phase6_financials applied to the dev DB).
- typecheck / lint / build clean. Demo seed re-run: 5 teacher rates, 14 session credits, 1 bonus, 1 payout (existence-guarded; append-only trigger untouched).
- Remaining owner steps: add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ private bucket) to enable attachment/proof uploads; create an EGP Paymob test-mode integration and fill the `PAYMOB_*` env names; USD gateway decision (Dodo vs Xpay) still open; Playwright E2E (`npx playwright test`) needs a dev server + credentials.

### 2026-10-18 — Implementation executed

- **Schema + migration `20261018000000_phase6_financials` (APPLIED to the dev DB, additive only):** `teacher_rates`, `payroll_ledger`, `payment_proofs`; enums `PayrollLedgerEntryType`/`PaymentProofStatus`; partial unique `payroll_ledger(session_id) WHERE entry_type='SESSION_CREDIT'`; sign CHECKs (credit > 0, adjustment ≠ 0, disbursement < 0), credit-snapshot CHECK (minutes + rate), manual-reason + creator CHECKs (system rows = SESSION_CREDIT with `created_by NULL`), proof review-state CHECK; append-only trigger reusing `prevent_ledger_mutation()`; RESTRICT FKs. The `(session_id, subscription_id) WHERE 'SESSION_DEDUCTION'` partial unique already existed (phase3_integrity).
- **Settlement (fills the Phase 5 seam, same approval transaction):** `lib/payroll/rates.ts` (`creditAmountMinor` integer half-up, `getRateForSession` effective-dated, `SettlementError`), `lib/reports/settlement-seam.ts` (ATTENDED → consume reservation + one deduction + negative-balance ADMIN flag (deduped notification, no amounts) + one first credit with rate snapshot + settled/archived markers; STUDENT_ABSENT → release reservation + zero money + markers; missing rate → `NO_TEACHER_RATE` rolls the whole approval back — no invented rates). Review route passes academy/teacher ids and maps `SettlementError` to its coded response.
- **APIs:** `POST /api/reports/[id]/overtime` (Admin; PENDING-only conditional update; approval writes ONE `ADMIN_ADJUSTMENT` at the same per-minute rate — never re-settles; post-commit teacher notice without amounts), `GET/POST /api/admin/teacher-rates` (Admin), `POST /api/payroll/adjustments` + `POST /api/payroll/disbursements` (Admin; reason required; `created_by` audit; disbursement recorded negative — an internal record, not proof of transfer), `POST /api/invoices` (Admin creates PENDING), `POST /api/invoices/[id]/confirm` (Admin; same atomic transition as the webhook via `settleInvoiceConfirmedByAdmin` — PAID + subscription + `INITIAL_PURCHASE` + attempt upsert `manual:{id}`; already-paid = clean `already_settled`), `POST /api/invoices/[id]/proofs` (payer-only: STUDENT adult-without-guardian or GUARDIAN of the child; magic bytes + 10 MB 413; private bucket; PENDING proof; rate-limited), `POST /api/invoices/[id]/proofs/[proofId]` (Admin CONFIRM/REJECT with note; decided proofs final).
- **Pages:** `/student/invoices` (adult-without-guardian gate; Pay now → hosted checkout redirect; proof upload; history), `/guardian/invoices` (per-child), `/admin/invoices` (create/confirm/proof review), `/teacher/payroll` (per-currency balances + pending-approval estimate + ledger), `/admin/payroll` (balances, rates, adjustments, payouts, consistency checks), `/admin/overtime` (queue). Nav links added for admin/teacher/guardian/student; supervisor nav and pages remain money-free (ADMIN-only gates server-side).
- **Worker:** `BALANCE_NEGATIVE` (Admin-only, no amounts) and `OVERTIME_DECISION` (teacher, no amounts) templates.
- **Seed:** teacher rates + 14 SESSION_CREDIT rows for the settled history + one bonus + one payout (all idempotent via existence checks — the append-only trigger is never disabled for payroll).
- **Verified:** `prisma validate` valid; typecheck clean; lint clean; migration applied (`migrate status` = 15 migrations, up to date); demo seed re-run populated payroll demo data.

### 2026-10-18 — Phase 6 implementation plan (owner-approved mission)

Existing and reused as-is: `Subscriptions`, `SubscriptionLedger`, `Invoices`, `PaymentAttempt` (append-only-safe), Paymob provider + HMAC webhook + `settlePaidInvoice` (row lock + paid-state idempotency), USD `NOT_CONFIGURED` boundary, Supervisor no-money routing.

Build order:
1. **Schema + migration `phase6_financials` (OWNER APPLIES):** `teacher_rates` (effective-dated; `hourly_rate_minor INTEGER`, ISO currency, `effective_from`, `created_by`), `payroll_ledger` (append-only trigger; `entry_type ∈ {SESSION_CREDIT, ADMIN_ADJUSTMENT, DISBURSEMENT}`; `amount_minor INTEGER`; `minutes_credited` + `hourly_rate_snapshot_minor` on credits; `created_by NULL` for system rows), `payment_proofs` (private-storage `file_path`, status PENDING/CONFIRMED/REJECTED, reviewer metadata). Raw SQL: partial unique `payroll_ledger(session_id) WHERE entry_type='SESSION_CREDIT'`; partial unique `subscription_ledger(session_id, subscription_id) WHERE entry_type='SESSION_DEDUCTION'`; append-only trigger on `payroll_ledger`; RESTRICT FKs.
2. **Settlement (`lib/reports/settlement.ts` fills the Phase 5 seam, same approval transaction):** ATTENDED → consume the (session, student) reservation, one `SESSION_DEDUCTION` (−1; P2002 = already done), one `SESSION_CREDIT` (rate = `teacher_rates` row with `effective_from <= scheduled_start`; missing rate → typed `NO_TEACHER_RATE` error that rolls the approval back — no invented rates), `settled_at` + `archived_at`, negative post-deduction balance → admin flag notification (deduped). STUDENT_ABSENT → release the reservation, zero money, `settled_at` + `archived_at` still set. Replacement sessions settle identically. Overtime never re-settles: separate Admin approval writes an `ADMIN_ADJUSTMENT` at the same per-minute rate.
3. **Payroll surfaces:** `POST /api/reports/[id]/overtime` (Admin; PENDING-only, idempotent), `GET/POST /api/admin/teacher-rates` (Admin), `POST /api/payroll/adjustments` + `POST /api/payroll/disbursements` (Admin, reason required, `created_by` audit). Pages: `/teacher/payroll` (per-currency earnings + ledger), `/admin/payroll` (balances per currency, adjustments, disbursements, consistency checks), `/admin/overtime` (queue). Supervisor never receives amounts (no routes, no data).
4. **Billing:** `POST /api/invoices` (Admin creates a PENDING invoice; amount from Admin input, never client-side at pay time), `POST /api/invoices/[id]/confirm` (Admin manual confirmation → the same atomic transition as the webhook: PAID + subscription + `INITIAL_PURCHASE`), `POST /api/invoices/[id]/proofs` (owner upload: magic-bytes allowlist, 10 MB, private bucket, PENDING proof), `POST /api/payment-proofs/[id]` (Admin confirm/reject with note). Pages: `/student/invoices`, `/guardian/invoices` (list, detail, pay via Paymob checkout, proof upload, history), `/admin/invoices` (create/confirm/proofs). Browser redirect is never authoritative; only the signed webhook or an explicit Admin confirmation moves money.
5. **Consistency checks** on `/admin/payroll`: approved/archived ATTENDED reports without a credit; ledger rows without a settled report; deductions without a settled report.

Owner decisions already locked (CONTEXT §7.9) are applied: INTEGER minor units, half-up rounding, one currency per teacher, reversal = Admin-only reversing entries (out of this batch unless trivially reachable), grace 3 days, min 1 / max 16 pay-per-session.

### 2026-10-20 � Phase 6b + payment-security pass (Session 2, "implement first, test after")

Implemented on `feature/phase-5` (HEAD 93e27a7 + this pass), reported **implemented, not verified**. Automated tests were NOT run (owner authorizes separately). Migrations were NOT applied.

- **Webhook atomicity/idempotency (B1):** `lib/payments/settlement.ts` now claims the event FIRST inside the settlement transaction (`webhook_events`, `UNIQUE(provider, provider_event_id)`) � the claim, the invoice `PAID` transition, the subscription, the `INITIAL_PURCHASE` ledger entry, and the payment-attempt upsert commit or roll back TOGETHER; a duplicate/concurrent delivery of the same event answers `already_processed` (P2002 caught inside the transaction). Signed non-success events are recorded as `IGNORED` and events without `merchant_order_id` as `UNMATCHED` (both redacted, best-effort, never change the webhook outcome). Payloads are stored through an allowlist ONLY (identification + outcome; card `source_data`, `owner`, customer fields never persisted). Before migration `20261020000000_phase6b_subscriptions_and_plans` is applied, `isPhase6bReady()` keeps the previous behavior (invoice row lock + PAID-state guard as the duplicate protection) � no crash.
- **Checkout concurrency (B2):** `POST /api/invoices/[id]/checkout` claims the invoice row (`FOR UPDATE`) in ONE transaction before calling the provider: concurrent POSTs serialize, at most one active attempt exists per invoice, the idempotency key is deterministic (`invoice:{id}:v{attemptNumber}` � never a timestamp), a fresh `REDIRECTED` attempt's URL is reused (< 50 min, inside Paymob's 3600 s payment-key expiry), an in-flight `CREATED` attempt (< 2 min) answers `409 CHECKOUT_IN_PROGRESS`, and stale/unusable attempts are failed before a takeover. The finance wall and ownership checks are unchanged.
- **Paymob env names (B3):** verified the implementation reads exactly `PAYMOB_API_URL`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_EGP`, `PAYMOB_IFRAME_ID_EGP`, `PAYMOB_HMAC_SECRET`; `.env.example` now lists these (unused `PAYMOB_PUBLICKEY`/`PAYMOB_SECRETKEY`/`PAYMOB_HMAC`/`PAYMOB_INTEGRATION_ID` removed from the example); CONTEXT �17 records the verification.
- **Exchange-rate snapshot (B4):** `POST /api/invoices` no longer accepts a client-supplied rate � the snapshot is selected server-side from the academy's `ExchangeRates` (invoice currency ? EGP, the demo-seed convention) at creation; EGP invoices and pre-migration states store null, exactly like the old optional-field behavior. Historical invoices keep their stored snapshot.
- **Monthly credit EXPIRY worker (B5, feasible part):** `lib/worker/credits.ts` (`processMonthlyCreditExpiry`, wired into the worker tick) writes the approved `EXPIRY` ledger entries at period end for unused monthly-plan (and annual monthly-window) credits � no rollover. Idempotent per subscription via ONE serializable transaction (row re-read under lock, expirable amount recomputed inside), reservations for not-yet-settled sessions survive period end, terminal status (`EXPIRED`/`EXHAUSTED`) finalizes exactly once from `ACTIVE`. A late settlement after expiry may drive the balance negative � the existing approved rule applies (settle + flag Admin).
- **Billing UI (B7):** Admin-only `/admin/billing` page + `AdminBillingPanel` (create/activate/deactivate/re-price plans, set exchange rates, pay-per-session min/max) on the existing Admin billing APIs; localized (ar/en), migration-pending degraded banner names the exact migration; nav item added to the ADMIN shell only; USD checkout still answers `NOT_CONFIGURED` � the page never implies a configured USD provider.
- **Test reconciliation (A1):** `__tests__/api/reports.test.ts` updated to the submit-time delivery contract (family `REPORT_SUBMITTED` jobs on submit, guardians AND students per visibility; approval enqueues nothing to the family; the failed-notice test now exercises a failed SUBMIT notice not rolling back the submission). Stale `MESSAGING_PROVIDER="fake"` setup line removed. NOT RUN � executes only with the owner's `Run the tests`.
- **BLOCKED � owner decision/provider contract required (unchanged by this pass):** annual-plan monthly credit grants (ledger entry type for grant-without-invoice + annual-term tracking are not defined by the approved docs; `BillingSubscription` is not populated by any flow yet); provider-managed renewal webhook parsing (Paymob subscription/renewal webhook contract is not in the repo � normalized `VerifiedPaymentEvent` seam kept, no invented fields); failed-renewal grace (depends on `BillingSubscription` lifecycle); USD gateway choice (Dodo vs Xpay � CONTEXT �17 conflict row, do not decide in code).
- **Pending migrations (OWNER APPLIES from `webapp/`, DIRECT_URL � verify with `npx prisma migrate status` first):** `20261018190000_session1_report_languages_monthly` (Session 1) and `20261020000000_phase6b_subscriptions_and_plans` (Phase 6b) � both additive; the code self-heals until they land.
- **Owner step (Paymob dashboard configuration � added 2026-10-20):** once the EGP test-mode integration exists, the owner must also configure Paymob to deliver transaction webhooks to `https://<your-host>/api/payments/paymob/webhook` (POST; the route reads the `hmac` header) and set the SAME secret in the `PAYMOB_HMAC_SECRET` env name � the server rejects unsigned/mismatched events with 401/400 and records nothing. The other required env names are exactly `PAYMOB_API_URL`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_EGP`, `PAYMOB_IFRAME_ID_EGP` (names only � never values in docs or Git).

## Session 3 (2026-10-24, owner-approved mission) — payment audit, evaluations, bell, WhatsApp, manual-payment hide

Owner-approved decisions for this session (do not reopen): Zoom stays manual links; report visible on SUBMIT; **session evaluations** — student AND guardian each rate 1–5 + optional comment, one per (session, author) incl. group sessions and multi-child guardians, editable 24 h then locked, THE TEACHER NEVER SEES IT (no route, payload, page, notification or count; not even anonymised), Admin AND Supervisor read it and relay manually (supersedes the older CONTEXT §9 "Admin-only" line); **payment audit** — append-only table, events created/paid/failed/cancelled/rejected/refunded, no card data, no gateway payload, Admin-only report page; **manual payment HIDDEN from UI/nav only** (hide-set = student/guardian proof upload + Admin manual confirm + Admin proof review; Admin Invoices nav, invoice creation and gateway "Pay now" STAY), all APIs stay reachable with unchanged authorization ("dormant but reachable"); **WhatsApp full channel** via OpenWA (unofficial — never the only channel for a critical flow; missing OPENWA_* → FAILED job, no rollback, no crash); **site-wide wa.me contact link** from AcademySettings (Admin-editable, never hardcoded, initial value 01060814239, support number = bot number); Phase 6b (renewal, billing_subscriptions, PLAN_GRANT, refund, USD gateway) stays OUT of scope. Automated tests are NOT run this session (owner authorizes the loop separately); per-slice test debt is appended to `docs/specs/test-backlog.md`.

### Slice A — Payment audit + manual-payment UI hide

- **Goal:** an append-only, minimal-metadata audit trail of every payment lifecycle event, visible to Admin only; hide the manual-payment UI (hide-set above) without touching any API.
- **Files:** `prisma/schema.prisma` (PaymentAudit), NEW migration `20261024000000_session3_payment_audit` (OWNER APPLIES), `lib/payments/audit.ts` (new write helper + readiness check `isPaymentAuditReady()`), write sites `app/api/invoices/route.ts` (CREATED), `lib/payments/settlement.ts` (PAID in `settlePaidInvoice` + `settleInvoiceConfirmedByAdmin`; FAILED for signed non-success/ignored events), `app/api/invoices/[id]/checkout/route.ts` (FAILED on stale-attempt takeover), `app/api/invoices/[id]/proofs/[proofId]/route.ts` (REJECTED), NEW `app/api/admin/payment-audit/route.ts` (GET), NEW page `app/[locale]/admin/payment-audit/page.tsx` + panel, `app/_components/dashboard-shell.tsx` (ADMIN nav item), hide edits in `app/_components/invoices/admin-invoices-panel.tsx` + `app/_components/invoices/invoice-payment-panel.tsx`, i18n `messages/ar.json`/`en.json`.
- **Data model (proposal — `payment_audit`):** `id UUID PK`, `academy_id UUID NOT NULL FK→academies RESTRICT`, `invoice_id UUID NULL FK→invoices RESTRICT` (NULL = event not linkable to an invoice, e.g. an unmatched webhook), `event_type VARCHAR NOT NULL CHECK (event_type IN ('CREATED','PAID','FAILED','CANCELLED','REJECTED','REFUNDED'))`, `actor_id UUID NULL FK→users RESTRICT` (NULL = system/webhook), `actor_role VARCHAR NULL CHECK (actor_role IN ('ADMIN','STUDENT','GUARDIAN','WEBHOOK','SYSTEM'))`, `metadata JSONB NULL` (allowlist only: attempt id, provider, provider reference, amount minor, currency, reason — NEVER card data, NEVER gateway payloads), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Indexes `(academy_id, created_at DESC)`, `(invoice_id)`. **Append-only:** `CREATE TRIGGER payment_audit_append_only BEFORE UPDATE OR DELETE ON payment_audit FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation()` (the function from `20261007150000_phase3_integrity` — the exact pattern the ledgers use). Producers today: CREATED (Admin invoice create), PAID (webhook settlement + Admin confirm — same transaction as the money move), FAILED (attempt-failure takeover + signed non-success webhook), REJECTED (proof reject). **CANCELLED and REFUNDED have NO producer today** — they arrive with Phase 6b (renewal/refund flows); the audit helper accepts them but nothing emits them yet (documented, not invented).
- **API:** `GET /api/admin/payment-audit` — ADMIN only (`requireApiRole("ADMIN")`), Zod query `{ invoiceId?: uuid, limit 1..100 default 50, cursor? }`; errors 401/403 generic; Supervisor gets 403. Audit rows are write-only from business code — no manual create/update API.
- **Security checks:** only Admin reads; metadata through one allowlist function (no PAN, no gateway JSON, no names/phones); audit INSERT joins the settlement transaction so a PAID row can never exist without its financial effects (fail-closed: audit failure rolls the money move back — retry is safe, settlement is idempotent); append-only enforced in the DB, not just code.
- **UI hide-set:** `admin-invoices-panel.tsx` loses the Confirm + proof-review actions (list + create + status stay); `invoice-payment-panel.tsx` loses the proof-upload section (gateway "Pay now" stays); NO nav item removed (owner: Admin Invoices nav stays). **Dormant but reachable (authz unchanged, listed for the final security pass):** `POST /api/invoices/[id]/confirm` (ADMIN), `POST /api/invoices/[id]/proofs` (STUDENT-adult-no-guardian/GUARDIAN + finance wall), `POST /api/invoices/[id]/proofs/[proofId]` (ADMIN).
- **Failure behaviour:** audit insert failure inside a money transaction aborts that transaction (fail-closed); best-effort audit for observability-only events (ignored/unmatched webhooks) never changes the webhook outcome; pre-migration (`isPaymentAuditReady()` false) all audit writes are skipped with a logged warning and the UI shows a migration-pending banner — no crash.
- **Manual checks for the owner:** create an invoice → audit row CREATED; Admin confirm → PAID; reject a proof → REJECTED; `/admin/payment-audit` reachable as Admin, 403 as Supervisor; proof upload + confirm buttons gone from the UI while the APIs still answer with their unchanged authorization; append-only verified (`UPDATE payment_audit ...` errors).
- **Risks:** existing historical invoices are not backfilled (documented); the hidden APIs remain an attack surface — unchanged authorization is deliberate and must be re-reviewed in the security pass.

### Slice B — Session evaluations (student + guardian)

- **Goal:** per the owner's decision: student and guardian each evaluate the session/teacher (rating 1–5 + optional comment), one per (session, author) incl. group sessions, editable 24 h then locked; Admin AND Supervisor read; the teacher NEVER sees it in any form.
- **Files:** `prisma/schema.prisma` (SessionEvaluation + `EvaluationAuthorType`), NEW migration `20261024100000_session3_evaluations` (OWNER APPLIES), `lib/evaluations/service.ts` (create/update/read with the 24 h lock), NEW routes `app/api/sessions/[id]/evaluations/route.ts` (POST/GET), UI component `app/_components/evaluations/evaluation-card.tsx` (Stitch `zarabicschool_17` tokens), student session page + guardian per-child session view integration, admin session-detail reserved panel filled (`app/[locale]/admin/sessions/[id]/page.tsx`), i18n.
- **Data model (proposal — `session_evaluations`):** `id UUID PK`, `academy_id UUID NOT NULL FK RESTRICT`, `session_id UUID NOT NULL FK→sessions RESTRICT`, `author_user_id UUID NOT NULL FK→users RESTRICT`, `student_id UUID NOT NULL FK→students RESTRICT` (roster anchor: the authoring student themself, or the guardian's roster child — informational when a guardian has several children in the session), `author_type VARCHAR NOT NULL CHECK (author_type IN ('STUDENT','GUARDIAN'))`, `rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5)`, `comment VARCHAR(2000) NULL`, `created_at/updated_at TIMESTAMPTZ NOT NULL`. **UNIQUE(session_id, author_user_id)** — the one-per-(session, author) rule incl. the group/multi-child edge (owner-confirmed). Indexes `(academy_id, created_at DESC)`, `(session_id)`. NOT append-only (24 h edit window); the lock is enforced server-side in code (update rejected with 403 `EVALUATION_LOCKED` once `now - created_at > 24 h`).
- **API:** `POST /api/sessions/[id]/evaluations` — same-origin; Zod body `{ rating: int 1..5, comment?: trim max 2000 }`; authz STUDENT (must be on the session roster via `session_students` → their user) or GUARDIAN (must be linked to at least one roster student of the session; `student_id` resolves deterministically to the guardian's first roster child of that session); errors: 401/403 (role/roster), 404 generic (no existence leak), 403 `EVALUATION_LOCKED` after 24 h, 409 on concurrent duplicate handled by upsert within the window. `GET` returns the caller's own evaluation only (students/guardians); Admin/Supervisor read happens through the session-detail data path, never a public evaluations list.
- **Security checks — the teacher never sees it:** no teacher route exists; no notification job kind is enqueued (no worker involvement at all); no teacher-facing page or data function selects `session_evaluations` (verified by grep after implementation); the admin/supervisor read path requires ADMIN or SUPERVISOR role; comment text is never logged. Unauthenticated/other-role calls get the generic 404/403.
- **Failure behaviour:** evaluation writes are independent of money and reports — a failure never rolls anything else back; pre-migration the routes answer a coded 409 `EVALUATIONS_MIGRATION_PENDING` (self-heals after the owner applies it).
- **Manual checks:** student (with guardian) and guardian both see the form on a finished session; both submit; both edit within 24 h; after 24 h the edit is rejected; Admin session-detail panel shows both evaluations side by side with the report (the reserved panel); the teacher's session/report pages show nothing new; group session → each author exactly once.
- **Risks:** the 24 h lock is code-enforced (no DB trigger) — a direct DB edit bypasses it, same trust level as the rest of the app's business rules; evaluations are visible to Supervisors by the owner's newest decision (relaying role) — the CONTEXT §9 "Admin-only" line is superseded and updated.

### Slice C — Notification bell on every page + teacher-report submission finding (item B)

- **Goal:** the unread-notification badge renders on every page of every role, computed server-side per viewer; teacher data never includes evaluation-related counts (no such jobs exist — verified).
- **Files:** `lib/notifications/unread-count.ts` (new server helper: count of the viewer's due/undelivered `notification_jobs`), `app/_components/dashboard-shell.tsx` (compute/count inside the shared shell instead of per-page `navBadges`), no API change.
- **Item B (investigation only, NO rule change):** trace why a teacher cannot submit a per-student report — the "after scheduled end" check (`app/api/sessions/[id]/students/[studentId]/report/route.ts:78`) vs how `scheduledEnd` was parsed at creation (`isoDateTime` in `lib/validation/management.ts`, the admin/teacher form payloads) and whether a timezone/UTC parsing mismatch shifts the stored end time. Finding goes into the phase-06 log with file:line; no code change without the owner.
- **Manual checks:** badge visible on every role page; counts differ per viewer; teacher's payload has no evaluation counts.

### Slice D — WhatsApp full channel (OpenWA-based) — DESIGN COMPLETE, awaiting owner approval before any code

OpenWA source read (read-only, `G:\programming\zarabicschool\OpenWA`, gitignored + untracked — verified `.gitignore:35`): `GET /health` public `{status,timestamp}` + version only with a valid key (`src/modules/health/health.controller.ts:62-76`), `GET /health/ready` 503 with per-dependency details (`:121-153`); per-session webhook CRUD `POST /sessions/:sessionId/webhooks` OPERATOR-role (`src/modules/webhook/webhook.controller.ts:13-30`) accepting `{url, events, secret, headers, filters, retryCount}` (`webhook.service.ts:197-205`); delivery POSTs with `X-OpenWA-Event`, `X-OpenWA-Idempotency-Key`, `X-OpenWA-Delivery-Id`, `X-OpenWA-Retry-Count` and `X-OpenWA-Signature: sha256=<HMAC-SHA256 of the exact body>` when a secret is set (`utils/deliver-once.ts:63-84`); event names incl. `message.ack` `{id, messageId, status, ack, chatId?}` and `message.failed` (`session/message-projector.service.ts:1229-1248`), `message.receipt` `{id, messageId, chatId, participant, status, timestamp}` (`:1271-1280`), `session.status` (`session/session-status-broadcaster.ts:67`); statuses sent/delivered/read/failed (`message/message-status.util.ts:12-19`); send = `POST /sessions/:sessionId/messages/send-text` OPERATOR role, `{chatId, text}` (`message/message.controller.ts:202-223`), errors 409 engine-not-ready / 400 recipient-unreachable / 429 pacing; API key via `X-API-Key` or Bearer (`auth/guards/api-key.guard.ts:231-235`).
- **Chosen design (owner to approve):** ONE new inbound route `POST /api/whatsapp/status` verifying `X-OpenWA-Signature` (timing-safe compare of the HMAC over the raw body with a new `OPENWA_WEBHOOK_SECRET` env name; no signature → 401, nothing stored); subscribed events ONLY `message.ack` + `message.failed` + `session.status` (payloads carry ids/statuses only — no message content; `message.received` is NOT subscribed so inbound chat content never reaches our DB); the handler matches `messageId` to `notification_jobs` and updates delivery state, storing no content. **Migration proposal (OWNER APPLIES):** add to `notification_jobs`: `provider_message_id TEXT NULL` + index, `delivery_status TEXT NULL CHECK (delivery_status IN ('SENT','DELIVERED','READ','FAILED'))`, `delivery_updated_at TIMESTAMPTZ NULL` — plus a NEW `admin_messages` table (`id, academy_id, recipient_user_id, created_by_user_id, body VARCHAR(4000) NOT NULL, created_at` + FKs) so Admin free-text content lives in its own table and `notification_jobs.payload` keeps the redaction rule (only `{adminMessageId}`). Admin individual message: `POST /api/admin/messages` (ADMIN; Zod `{recipientUserId uuid, body trim 1..4000}`; enrols one `ADMIN_MESSAGE` job whose worker template sends `body` verbatim from `admin_messages`); Admin-only health check `GET /api/admin/whatsapp/health` (server-side fetch of `${OPENWA_URL}/health` + `/health/ready`, never logs the key); wa.me link from AcademySettings key `site.whatsapp_number` (initial 01060814239, Admin-editable via a small settings API, rendered in the landing footer; rendered through the existing `normalizeEgyptPhone` so wa.me gets international format). Worker gains the `ADMIN_MESSAGE` template + a health-check is NOT polled automatically (owner checks via the Admin page).
- **STOP:** per the owner's instruction, the WhatsApp code is written only after the owner approves this design summary.

### Slice E — `.env.example` + docs

Add `OPENWA_WEBHOOK_SECRET` (names only), remove the stale `MESSAGING_PROVIDER`, confirm `OPENWA_URL/OPENWA_API_KEY/OPENWA_SESSION_ID` present; finalize phase-06/PROGRESS updates.

### Slice F — Roster (BLOCKED on owner)

Owner confirmed via read-only SQL that NO session exists without `session_students` rows, so it is not a data problem and all code creation paths are verified to write the roster. Waiting for the page name/screenshot before touching anything.

### 2026-10-24 — Slice A implemented (payment audit + manual-payment hide)

**Implemented, not verified** (static checks only; tests deferred). Migration `20261024000000_session3_payment_audit` CREATED, NOT APPLIED — owner applies from `webapp/` with DIRECT_URL. `npx tsc --noEmit`, `npm run lint`, `npm run build` all exit 0 after the slice.

- `prisma/schema.prisma`: `PaymentAudit` model (`payment_audit`) + back-relations on Academy/Invoice/User. Migration: CHECK on event type/actor role, RESTRICT FKs, indexes `(academy_id, created_at DESC)` + `(invoice_id)`, append-only trigger `payment_audit_append_only` reusing `prevent_ledger_mutation()`.
- `lib/payments/audit.ts`: `isPaymentAuditReady()` (information_schema probe, self-heals once applied), `writePaymentAudit(input, tx?)` with a 10-key metadata allowlist (no card data, no gateway payload ever), `bestEffort` mode for observability-only writes, in-transaction mode for money moves (fail-closed).
- Write sites: invoice CREATE (`app/api/invoices/route.ts` — now one transaction: create + CREATED row, actor ADMIN); webhook settlement + Admin confirm PAID (`lib/payments/settlement.ts` — inside both settlement transactions, fail-closed); signed non-success/unmatchable webhook → FAILED best-effort (academy resolved from the invoice; UNMATCHED events skip the audit row — they stay in `webhook_events`); checkout stale-attempt takeover + provider-refused checkout → FAILED (`app/api/invoices/[id]/checkout/route.ts`, actor role narrowed server-side); proof REJECT → REJECTED (`app/api/invoices/[id]/proofs/[proofId]/route.ts`, same transaction as the review).
- Admin report: `/[locale]/admin/payment-audit` page (ADMIN-only via `requireRole("ADMIN")`, event-type + invoice filters, 100-row window, migration-pending banner); ADMIN nav item "paymentAudit" in the shell. No new read API route — the server component queries directly (smaller auth surface).
- Manual-payment UI HIDDEN (owner hide-set): `admin-invoices-panel.tsx` lost the manual-confirm + proof-review forms; `invoice-payment-panel.tsx` lost the proof-upload form (gateway "Pay now" + invoice create/list STAY). Dormant-but-reachable APIs with unchanged authorization: `POST /api/invoices/[id]/confirm`, `POST /api/invoices/[id]/proofs`, `POST /api/invoices/[id]/proofs/[proofId]`.
- Test debt appended to `docs/specs/test-backlog.md` (PA-01..PA-09).

### 2026-10-24 — Slice B implemented (session evaluations)

**Implemented, not verified** (static checks only; tests deferred). Migration `20261024100000_session3_evaluations` CREATED, NOT APPLIED — owner applies from `webapp/` with DIRECT_URL. `npx tsc --noEmit`, `npm run lint`, `npm run build` all exit 0 after the slice.

- `prisma/schema.prisma`: `EvaluationAuthorType` enum (STUDENT/GUARDIAN) + `SessionEvaluation` model (`session_evaluations`): `UNIQUE(session_id, author_user_id)` (the one-per-(session, author) rule incl. group sessions and multi-child guardians), `rating` CHECK 1..5, optional `comment` VARCHAR(2000), `student_id` roster anchor, FKs RESTRICT, indexes `(academy_id, created_at DESC)` + `(session_id)`. NOT append-only (24h edit window); the lock is server-enforced.
- `lib/evaluations/service.ts`: `isEvaluationsReady()` probe; `submitEvaluation` (eligibility = STUDENT on the roster / GUARDIAN linked to a roster child; session ended + not CANCELLED/MISSED; 24h lock; P2002 race recovery re-reads and continues as an update within the window); `getOwnEvaluation` (author-only); `getEvaluationsForSession` (Admin/Supervisor read). NO notification is enqueued anywhere in the module.
- Route `app/api/sessions/[id]/evaluations` (POST + GET, STUDENT/GUARDIAN only, same-origin): Zod `{rating int 1..5, comment ≤2000}`; coded errors — 409 `EVALUATIONS_MIGRATION_PENDING` (pre-migration), 404 generic for non-roster callers (no existence oracle), 409 `SESSION_NOT_EVALUABLE`, 403 `EVALUATION_LOCKED`, 409 `EVALUATION_CONFLICT`.
- UI: shared `EvaluationCard` (1–5 buttons, optional comment, locked state; Stitch `zarabicschool_17` tokens) on the student report page (post-session only) and collapsed per report card on the guardian reports page; the Admin session-detail reserved panel now renders the evaluations READ-ONLY for ADMIN **and** SUPERVISOR (owner's newest decision; the CONTEXT §9 "Admin-only" line is superseded).
- **Teacher-never-sees verified by grep:** zero evaluation references in `app/[locale]/teacher/**`; every `sessionEvaluation` query lives in `lib/evaluations/service.ts`; no notification job kind exists for evaluations.
- Known gap (documented, not invented): a guardian evaluates from the reports page per session-report card — a guardian currently has no UI entry for an ended session that has NO submitted report (the API accepts it; a per-session guardian view is Phase 9 material).
- Test debt appended to `docs/specs/test-backlog.md` (EV-01..EV-09).

### 2026-10-24 — Slice C implemented (notification bell + item B finding)

**Implemented, not verified** (static checks only). Migration `20261024200000_session3_notification_read_at` CREATED, NOT APPLIED — owner applies from `webapp/` with DIRECT_URL (`notification_jobs.read_at` + a partial unread index). tsc/lint/build exit 0.

- **Bell on every page (item A):** new `lib/notifications/badge.ts` + `GET/POST /api/notifications/badge` — counts computed SERVER-SIDE per viewer: ADMIN/SUPERVISOR get the team-queue depths (open applications, SUBMITTED reports, PENDING outage requests — the same numbers the dashboards already passed per page, now everywhere); TEACHER/STUDENT/GUARDIAN get their OWN unacked `notification_jobs` (`read_at IS NULL`, statuses PENDING/SENT, SQL-excluded `EVALUATION%` kinds — evaluation jobs do not exist at all, so a teacher can never receive an evaluation count). The shared shell header renders the bell on EVERY page of every role; a family-role click acks (POST → `read_at = now`) then navigates to their dashboard; operator queue badges keep their existing per-page behavior. Pre-migration the family count answers 0 (self-heals).
- **Item B finding (rule NOT changed):** the "after scheduled end" gate is timezone-correct — `z.string().datetime({ offset: true })` rejects ambiguous local strings (`lib/validation/management.ts:111`), the admin form converts wall clock → UTC with the DST-safe `wallClockInputToUtc` in the session's timezone (`lib/schedules/recurrence.ts:36-39`; `use-smart-session-form.ts:103,130`), and the gate compares instants (`report/route.ts:78`). The bug was DISPLAY: the teacher's "not finished until {time}" message formatted `scheduledEnd` WITHOUT a `timeZone` option (`teacher/sessions/[id]/report/page.tsx:71`) → the server's local zone (UTC on a host) — a Cairo teacher saw a wrong end time. Fixed to the viewer's timezone; the submit rule and its timing are untouched. If the owner's teacher case still reproduces, the exact error shown to the teacher (NOT_FINISHED / SESSION_NOT_REPORTABLE / ALREADY_SUBMITTED / 404) will pinpoint the gate.
- Test debt appended (NB-01..NB-05, RB-01).

### 2026-10-25 — fix/session-reports-ui (owner findings from screenshots)

Branch `fix/session-reports-ui` (from `feature/phase-5`). Static checks only (tsc/lint/build exit 0 after every step); tests deferred.

- **Diagnosis (a) — session status:** the report POST accepts a `SCHEDULED` session after its scheduled end (blocks only CANCELLED/MISSED — `app/api/sessions/[id]/students/[studentId]/report/route.ts:78-84`). NOTHING writes `sessions.status = COMPLETED`: settlement does not, the worker does not, and the Admin PATCH allows only cancellation (`app/api/sessions/[id]/route.ts:46-48`). `database-schema.md:246` names `SCHEDULED → IN_PROGRESS → COMPLETED` without a trigger (and `IN_PROGRESS` is not in the enum); CONTEXT defines no rule. **OPEN — owner decides who/what completes a session.** Meanwhile the teacher/student lists show a DISPLAY-ONLY "ended" label for a SCHEDULED session past its end; stored status untouched.
- **Diagnosis (b) — raw remark slug:** the demo seed stores `needs_follow_up` (`prisma/seed-demo.ts:257`), absent from the default list and from the legacy map (key `"needs follow-up"`); `classRemarkLabel` returned the slug when not found, and pages rendered the slug whenever `view.language` was missing.
- **Step 2 — teacher roster report buttons:** shared `RosterReportAction` on `/teacher/sessions` (today + all) and the teacher dashboard: disabled with "available after the session ends (time in viewer tz)" before the end; write / awaiting review / approved / edit-after-rejection (+ reason). Report form: files pickable before the first submit (uploaded right after acceptance; failure never undoes the report), localized coded errors, read-only view of SUBMITTED/APPROVED content. API rules unchanged.
- **Step 3 — student:** new `/student/reports` (nav "تقارير الحصص") via `getReportForViewer` as STUDENT (visibility rules unchanged); "قيّم الحصة" on ended session cards and report cards (existing EvaluationCard/API, 24h lock unchanged; no teacher file imports evaluations). Shared `AttachmentList` opens files via the signed-URL route (student, guardian).
- **Step 4 — remark labels:** `classRemarkLabel` falls back to built-in labels (seed + legacy incl. `needs_follow_up`) before the slug; all viewers use the report language or the UI locale (`remarkDisplayLanguage`).
- **Step 5 — Cloudinary:** `CloudinaryStorageProvider` (REST, server-side SHA-1 signatures checked against Cloudinary's documented example; type `authenticated`, resource_type `auto`; signed Download-API URL with `expires_at`, 300 s). The interface carries the object identity; Fake + test seam kept; Supabase = legacy read path. Migration `20261025000000_cloudinary_storage_columns` **CREATED, NOT APPLIED** (owner applies with DIRECT_URL); before it, uploads answer 409 `STORAGE_MIGRATION_PENDING`, legacy reads keep working. Report attachments accept audio (MP3/M4A/OGG/WAV) by signature; proofs stay images+PDF; 10 MB cap unchanged. Payment proofs use the same provider (no proof download route exists — unchanged). Existing data: 4 `report_attachments` rows (all demo teachers), 0 `payment_proofs`; the configured Supabase key answers 403 when signing them, so their objects could not be verified — nothing migrated or deleted.

### 2026-10-25 — Session 4: report-form rejection fix + session completion by reports

**Item 1 — fully filled report rejected (fixed, commit `d411ae9`).** Evidence: the red message was `teacherReport.errors.VALIDATION_ERROR`, which the form showed for EVERY server `VALIDATION_ERROR` (client checks produce different text). The server's 400 came from the path check `app/api/sessions/[id]/students/[studentId]/report/route.ts:52-55`: Zod 4 `z.string().uuid()` is RFC-strict (version/variant nibbles), and 7 demo-seeded sessions have ids like `00000000-0000-0000-0000-000000000603` (`prisma/seed-demo.ts:30`), valid for Postgres `uuid` but rejected by Zod. Both owner screens hit it (the 19/10 session and the 17/10 REJECTED report); the attachment upload worked because it validates the REPORT id (DB-generated v4). Verified with real data: old check false / new check true for those ids; the body schema passes for ar and de payloads; the remark `good` is in the list the API validates (the AcademySettings row uses key `class_remark_options`, not the code's `report.class_remarks`, so the default list applies — noted, not changed). Fix: all 39 identifier checks use `z.guid()` (any 8-4-4-4-12 hex = the Postgres uuid format; garbage still rejected) — no authorization/business rule changed. Form: a stored remark slug missing from the list starts empty (a controlled `<select>` with no matching option DISPLAYS the first enabled option while the state keeps the stale slug); server `VALIDATION_ERROR` names the failing field; network failures handled. Attachment flow re-checked: files upload only after the report is accepted; a rejected/failed submit uploads nothing; the upload route is request-atomic (failure removes the request's objects and rows); after the post-acceptance upload the list is re-read from the server so a retry never duplicates.

**Item 2 — RULE (owner decision 2026-10-25, CONFIRMED): the teacher's reports complete the session.**
- Each roster student has an independent report. A session stays `SCHEDULED` until EVERY roster student has a submitted session report (a report row in any status — "submitted at least once"; interpretation flagged to the owner), and at that moment it becomes `COMPLETED`.
- The transition runs inside the SAME DB transaction as the report submit that completes the roster (`lib/reports/session-completion.ts`, called from the report route). The transaction first locks the session row (`SELECT … FOR UPDATE`) — without it, two concurrent last reports would each count N-1 under READ COMMITTED (write skew) and neither would complete the session. The conditional update (`WHERE status = 'SCHEDULED'`) makes resubmits/replays write nothing; CANCELLED/MISSED are never touched.
- Resubmission after rejection is a conditional update (`WHERE status = 'REJECTED'`) inside the same locked transaction.
- A REJECTED report does NOT revert the status. Completion writes NO `SubscriptionLedger`/`PayrollLedger` row — settlement stays driven only by Admin/Supervisor approval of each report.
- Display: an ended session not yet COMPLETED shows "انتهى موعدها · بانتظار التقارير (X من Y)" on teacher and admin session cards (derived from existing data; no new status value). Report counts are exposed to staff roles only (family roles never learn classmates' report state).
- Inspection (no conflict): the late-report chain (`lib/worker/notifications.ts:277-288, :341`) skips fully reported sessions, and a newly COMPLETED session is fully reported by definition; settlement (`settlement-seam.ts`) and credit reservations never read session status. Behaviour changes to note: Admin can no longer edit/cancel a fully reported session (`app/api/sessions/[id]/route.ts:40` treats COMPLETED as immutable), and a whole-session outage approval no longer marks it MISSED (`session-requests/[id]/review/route.ts:154`); dashboard completed/upcoming counts become accurate.
- No migration. Verification: tsc/lint/build exit 0; the lock statement probed on the real DB in a rolled-back transaction with a legacy-format id. Tests deferred (backlog SC-01..SC-08).

### 2026-10-25 — Session 5 Part 1: WhatsApp slices (d) + (e) implemented (branch `feature/whatsapp`)

**Implemented, not verified** (tests deferred). `npx tsc --noEmit` exit 0, `npm run lint` exit 0, `npm run build` exit 0. Migration `20261026000000_whatsapp_delivery_admin_messages` **CREATED, NOT APPLIED** (no BOM; owner applies with DIRECT_URL). Live send **skipped**: OpenWA was not running on this machine (the local port refused the connection on GET `/api/health`).

Review of the existing WhatsApp path — bugs found and fixed (messaging only):
- **W1 (Critical): every send failed.** The adapter posted to `/api/sendText` with `{sessionId, chatId, text}`; OpenWA exposes `POST /api/sessions/:sessionId/messages/send-text` with `{chatId, text}` (`OpenWA/src/modules/message/message.controller.ts:202`, global prefix `api` in `src/config/app-validation.ts:49`). Fixed in `lib/messaging/openwa-provider.ts`.
- **W2 (High): chat id.** The stored phone (`+20…`) was used as `chatId`; OpenWA needs `<digits>@c.us`. New `lib/messaging/phone.ts`: `+`/`00` numbers pass through unchanged; only Egyptian local formats (`01XXXXXXXXX`, `1XXXXXXXXX`) become `201XXXXXXXXX`; a bare `201…` is already international; anything else is REFUSED (never guessed).
- **W3 (High, safety): demo numbers.** Once W1 is fixed, a dev worker would deliver every queued job to the demo-seed phones (possibly real people). New guard: outside `NODE_ENV=production` the adapter sends ONLY to numbers in `OPENWA_SEND_ALLOWLIST` (unset = nothing sent; the job is FAILED with a clear reason).
- **W4 (Medium): no retry except report nudges.** Transient failures (network/timeout, HTTP 409 engine-not-ready, 429 pacing, 5xx) now retry: max 3 sends, 2 min then 10 min. Permanent failures (400 unregistered, 401/403, 404, missing config, bad number) → FAILED at once. The late-report re-arm (attempts < 2) still works on top. The job id is sent as OpenWA's `Idempotency-Key`, so a retry is never delivered twice.
- **W5 (Medium): stuck jobs.** A crash between claim and send left jobs in `PROCESSING` forever. Now `PROCESSING` older than 10 min → FAILED ("worker interrupted"), never auto re-sent.
- **W6 (Medium): stale notices.** After a worker outage, `SESSION_REMINDER` and `SESSION_START` (join link) were still sent for sessions already over. Now cancelled once `scheduledEnd` has passed.
- **W7 (Low): burst sending.** 1.5 s between sends in one tick and no overlapping ticks (`lib/worker/start.ts`) to lower the ban risk.
- **W8 (Low): hardcoded brand.** The credentials message said "Zarabicschool"; it now uses the academy name from the DB.
- Reviewed, no change needed: every enqueue site uses a unique `dedup_key` + `skipDuplicates` (no duplicate jobs); report notices go to the student + linked guardian only; job rows store ids/keys only (credentials are sent directly by the approval route; the password never enters a row); Zoom links are composed at send time, never stored.
- **Not fixed (in the plan):** session/admin notice templates exist only in ar/en (fr/de/tr users get Arabic for non-report notices); the application form accepts Egyptian numbers only (`lib/validation/application.ts:3-11`, S8) — a form/business change; Admin has no view of FAILED jobs; `.env` lists `OPENWA_API_KEY` and `OPENWA_SESSION_ID` twice with DIFFERENT values (the last one wins) — owner to clean up; the proxy's 120 req/min/IP limit also applies to the webhook (fine at our volume).

New (slice d as approved + Session 5 amendments):
- `POST /api/whatsapp/status`: raw body via `request.text()` before `JSON.parse`; `X-OpenWA-Signature: sha256=<hex HMAC-SHA256>` with `OPENWA_WEBHOOK_SECRET`, `timingSafeEqual`; no secret / missing / wrong signature → 401, nothing stored; 64 KB cap; envelope `{event, sessionId, timestamp, idempotencyKey, deliveryId, data}` (`OpenWA webhook-delivery.service.ts:537-541`); other `sessionId` → ignored. `message.ack`/`message.failed` → forward-only `delivery_status` by `provider_message_id` (SENT → DELIVERED → READ; FAILED never overwrites DELIVERED/READ), so replays are no-ops. `session.status` → status word logged only. Unknown events → 200 ignored. No message content stored.
- `GET /api/admin/whatsapp/health` — ADMIN only; server-side fetch of `/api/health` + `/api/health/ready`; returns reachability, HTTP status, status word; the key never leaves the server.
- `POST /api/admin/messages` — ADMIN only (Supervisor 403), same-origin, Zod `{recipientUserId: guid, body: trim 1..4000}`, 20 per 10 min per Admin; recipient active, same academy, with a phone; ONE transaction writes `admin_messages` + an `ADMIN_MESSAGE` job with payload `{adminMessageId}`; the body is never logged nor returned; the worker loads it at send time.
- `GET/PUT /api/admin/settings/whatsapp-number` — ADMIN only; key `site.whatsapp_number`; the initial `01060814239` is inserted by the migration (not by code). Landing page (floating button) + footer render `https://wa.me/<digits>`; no row → no link.
- Admin page `/[locale]/admin/whatsapp` (ADMIN nav only): health check, contact number, individual message.
- Pre-migration: messages answer 409 `WHATSAPP_MIGRATION_PENDING`, the webhook acks without storing, the worker skips message-id storage (probe `lib/messaging/readiness.ts`, self-heals).
- `.env.example` (slice e): `MESSAGING_PROVIDER` removed (never read); added `OPENWA_WEBHOOK_SECRET`, `OPENWA_SEND_ALLOWLIST`, `ALLOWED_ORIGINS` (names only).

**Migration to apply (owner):** `20261026000000_whatsapp_delivery_admin_messages` — `notification_jobs` + `provider_message_id VARCHAR(255)`, `delivery_status VARCHAR(16)` CHECK (SENT/DELIVERED/READ/FAILED), `delivery_updated_at TIMESTAMPTZ` + index on `provider_message_id`; new `admin_messages` (RESTRICT FKs, body VARCHAR(4000) non-blank CHECK, indexes `(academy_id, created_at DESC)`, `(recipient_user_id)`); inserts `site.whatsapp_number = "01060814239"` per academy (`ON CONFLICT DO NOTHING`). From `webapp/`: `npx prisma migrate deploy`.

**Manual webhook registration (owner; never from app code).** Placeholders only — put real values in your shell, not in files:

```bash
# 1) pick a long random secret; put the SAME value in webapp/.env as OPENWA_WEBHOOK_SECRET
# 2) register on the connected session (OPERATOR-role key)
curl -X POST "<OPENWA_URL>/api/sessions/<OPENWA_SESSION_ID>/webhooks" \
  -H "X-API-Key: <OPENWA_API_KEY>" -H "content-type: application/json" \
  -d '{"url":"<APP_BASE_URL>/api/whatsapp/status","events":["message.ack","message.failed","session.status"],"secret":"<OPENWA_WEBHOOK_SECRET>","retryCount":3}'
# 3) confirm (and get the id if you ever need to delete it)
curl "<OPENWA_URL>/api/sessions/<OPENWA_SESSION_ID>/webhooks" -H "X-API-Key: <OPENWA_API_KEY>"
```

`<APP_BASE_URL>` must be reachable FROM the OpenWA host (locally `http://localhost:3000`). Never subscribe `message.received` (inbound chat content must not reach our DB).

**Manual live test (owner):** start OpenWA (session connected) → `OPENWA_SEND_ALLOWLIST=01229911425,01288088139` in `webapp/.env` → apply the migration → `npm run dev` → `/admin/whatsapp` "Check now" → give a TEST account the phone 01229911425 → send an individual message → within ~1 min the job is SENT; with the webhook registered `delivery_status` moves to DELIVERED/READ → message a user without a phone → 409 → stop OpenWA and send → retried twice, then FAILED. A handful of messages, seconds apart.

**Risks:** OpenWA is unofficial (ban risk; never the only channel); production ignores the allowlist by design; Admin messages can reach minors' phones (privacy/consent = launch gap, Session 5 plan J); the webhook trusts one shared secret — rotate if it leaks.

## Session 5 (2026-10-25) — Stage 2 plan (PLAN ONLY — no payment or security code until the owner says "approved")

Source findings: `docs/reviews/2026-10-25-stage1-review.md` (linked as `docs/specs/review-session4.md`). Order (owner-approved): **A payment safety → B security quick wins → C low-risk performance → D schema drift + docs**; E (payment-link message) and F (PLAN_GRANT) are design only. Every item: tests are NOT written now — the IDs below are appended to `test-backlog.md`. Verification per item = `npx tsc --noEmit`, `npm run lint`, `npm run build` + the owner's manual checks. Every new migration = file only, no BOM, owner applies with DIRECT_URL. Branch per group (`fix/payments-safety`, `fix/security-quick-wins`, `perf/quick-wins`), small commits, never merged by the agent.

Owner answers recorded (2026-10-25): (1) order approved; (2) `npm cache clean` approved; (3) fix `prisma/seed-demo.ts` so it never writes approved reports without settlement — edit only, never run; the owner clears + reseeds; the 6 fully reported sessions become COMPLETED through the reseed; (4) pay-per-session: keep the key the running code reads, remove the other from code and seed, document in CONTEXT; (5) forced password change after an admin-set password for ADMIN, SUPERVISOR, TEACHER now (students/guardians → Phase 9), additive column, migration file only.

### A0 — Seed + settings-key cleanup (data only, no money code)
- **Goal:** the demo seed never produces an `APPROVED`/`ARCHIVED` report without the settlement rows; one pay-per-session key.
- **Facts:** the running code reads `billing.pay_per_session.min` / `.max` (`lib/billing/pay-per-session.ts:5,25-27`; written by `app/api/admin/billing/settings/pay-per-session/route.ts`). The seed writes the unread `pay_per_session_min/max` (`prisma/seed-demo.ts:287-288`). The seed writes report `status` directly (`seed-demo.ts:698-726`): `APPROVED` gets no `settled_at` and no ledger rows; `ARCHIVED` gets `settled_at` but no ledger rows written by the seam.
- **Files:** `prisma/seed-demo.ts` only. Change: every seeded report that is `APPROVED`/`ARCHIVED` is written as `SUBMITTED` (the owner approves them in the UI, which runs the real settlement) — no fake settlement in the seed. Seed keys → `billing.pay_per_session.min/max`. Also seed `class_remark_options` → the code key `report.class_remarks` (same drift, Stage 1). CONTEXT §7 gets one line naming the authoritative key.
- **Data model:** none. Stale DB rows `pay_per_session_min/max` stay until the owner's clear (`db:clear:demo` does not delete `academy_settings` — owner deletes the two keys by hand or we add them to the clear script; owner choice).
- **Manual check:** after the owner's reseed, `SELECT count(*) FROM reports WHERE status IN ('APPROVED','ARCHIVED') AND settled_at IS NULL` = 0.
- **Tests:** SEED-01 (no approved-without-settlement rows after seed), SEED-02 (only `billing.pay_per_session.*` keys).

### A1 — Paymob webhook correctness (P1, P2, P3, P4, P12) — requesting-code-review before merge
- **Goal:** an invoice becomes PAID only for a genuine, captured, non-voided, non-refunded payment of exactly the invoice's amount and currency, matched through a value covered by the HMAC.
- **Files:** `lib/payments/paymob.ts` (`verifyWebhook`, `createCheckout`), `lib/payments/settlement.ts`, `app/api/payments/webhook/route.ts`, `app/api/invoices/[id]/checkout/route.ts`, `prisma/schema.prisma` + new migration.
- **Rules:**
  1. Success = `success === true` AND `pending === false` AND `is_voided === false` AND `is_refunded === false` AND `is_void !== true` AND `is_refund !== true` AND `error_occured !== true` AND NOT (`is_auth === true` AND `is_capture !== true`). Anything else is a non-success event (recorded, never settles).
  2. Invoice matching: by the Paymob **`order.id`** stored at checkout (HMAC-covered field `order`), NEVER by `merchant_order_id` (not in the HMAC). `merchant_order_id` becomes informational only and unique per attempt: `<invoiceId>:<attemptNo>` (P12 — Paymob rejects a repeated merchant_order_id).
  3. Before settling: `amount_cents === invoice.amountMinor` AND `currency === invoice.currency` AND attempt.provider = PAYMOB AND invoice PENDING. Mismatch → event stored `MISMATCH`, audit FAILED (best-effort), Admin flag job, HTTP 200 (Paymob must not retry forever), no money.
  4. Idempotency: keep `UNIQUE(provider, provider_event_id)`. P2 fix: the claim key for settlement is the transaction id **only for success events**; non-success events are stored under `<txnId>:<state>` so a later success for the same transaction is not blocked. Settlement stays ONE transaction (claim + PAID + `INITIAL_PURCHASE` + audit).
  5. A success for an already-PAID invoice, or a refund/void callback for a PAID invoice → no money change; audit row + `PAYMENT_ANOMALY` Admin flag (P11). Refund handling itself waits for the refund rules (OPEN).
- **Data model (migration `…_paymob_order_match`, file only):** `payment_attempts.provider_order_id VARCHAR(64) NULL`, `payment_attempts.provider_transaction_id VARCHAR(64) NULL`; partial unique `UNIQUE (provider, provider_order_id) WHERE provider_order_id IS NOT NULL`; index `(provider, provider_transaction_id)`. Backfill: none needed (no real payments yet; 11 demo PAID invoices keep their rows). Today `settlement.ts:232` OVERWRITES `providerReference` (the order id) with the transaction id — after the change `provider_reference` keeps the order id and the transaction id goes to the new column. `webhook_events.status` CHECK gains `MISMATCH` if it has a CHECK (verify in the migration).
- **API contract:** `POST /api/payments/webhook` (unchanged route; no session auth). 401 bad/missing HMAC (nothing stored), 400 malformed JSON, 200 for everything signed (`settled` / `already_processed` / `ignored` / `unmatched` / `mismatch`). Zod schema for the parsed `obj`: `{ id: number, success: boolean, pending: boolean, is_voided, is_refunded, is_auth, is_capture, error_occured: boolean, amount_cents: int>0, currency: string, order: { id: number, merchant_order_id?: string } }`.
- **Security:** HMAC (SHA-512, timing-safe) stays first; replay = same event id → `already_processed`; settlement transaction + row lock unchanged; only the webhook and the Admin confirm action can set PAID.
- **Failure behaviour:** DB error → 500 → Paymob retries → idempotent. Unknown order id → `unmatched` stored, no money.
- **Owner must confirm in the Paymob sandbox (needs sandbox):** (a) the processed-callback shape — `{type:"TRANSACTION", obj:{…}}` with `?hmac=` in the QUERY string vs our current `hmac` header + flat body (P4: if Paymob uses the query, every real callback is 401 today); (b) the exact HMAC field list/order for the processed callback; (c) the sequence for a 3-DS card: is a `pending:true` callback sent first with the same transaction id?; (d) whether void/refund arrive as new transactions or updates of the same id; (e) that a second payment key on the same order works after expiry; (f) whether a Paymob **MOTO integration** exists in the dashboard (owner question).
- **Manual checks:** sandbox success → PAID once; replay the same callback → `already_processed`; tamper amount → 401 (HMAC) / craft wrong-amount sandbox order → `mismatch`, invoice PENDING; declined card → invoice PENDING, later success settles.
- **Risks:** the callback shape is unverified until the sandbox run; until A1 ships, NO real payment should be accepted.
- **Tests:** PM-01..PM-10 (each success-predicate flag false/true; order-id match; merchant_order_id ignored; amount/currency mismatch; pending→success same txn; success on PAID invoice; replay; concurrent duplicate).

### A2 — Report approval refuses a CANCELLED session (P5)
- **Goal:** approving a report of a CANCELLED session returns **409 `SESSION_CANCELLED`** and moves nothing.
- **Files:** `lib/reports/settlement-seam.ts:40-46` (read `session.status` inside the settlement transaction, after the row lock), `app/api/reports/[id]/review/route.ts` (map the coded error).
- **Rule:** status check inside the same transaction (no TOCTOU). Exception only through the existing audited Admin manual resolution (reason mandatory) — no "force" flag on the approve route. **Decision needed:** should `MISSED` also be refused (a MISSED session "did not take place", CONTEXT §7)? Proposal: yes, same 409 `SESSION_NOT_SETTLEABLE` with the status in the body.
- **API:** `POST /api/reports/:id/review {action:"APPROVE"}` → 409 `{error:{code:"SESSION_CANCELLED"}}`; ADMIN/SUPERVISOR only (unchanged).
- **Tests:** RA-01 (cancelled → 409, zero ledger rows), RA-02 (cancel between submit and approve), RA-03 (reject still allowed on a cancelled session).

### A3 — Overtime approval + ledger in ONE transaction (P6, INSTRUCTIONS §7)
- **Goal:** `extraTimeStatus = APPROVED` and its `ADMIN_ADJUSTMENT` payroll row commit or roll back together.
- **Files:** `app/api/reports/[id]/overtime/route.ts:52-86`. Move the conditional `updateMany` (claim) INTO the `$transaction` that writes the ledger; `NO_TEACHER_RATE` throws → rollback → claim stays `PENDING` → 409 `NO_TEACHER_RATE`, retry possible. Idempotency: unique ledger key per report (verify an existing unique `(report_id, entry_type)` or add a partial unique `payroll_ledger(report_id) WHERE entry_type='ADMIN_ADJUSTMENT' AND reason_code='OVERTIME'` — migration if missing). Notification enqueued after commit.
- **API:** ADMIN only; Zod `{decision: "APPROVE"|"REJECT"}`; 409 `ALREADY_HANDLED` for a second click (200 with `alreadyHandled` today — keep 200 for idempotent replays).
- **Tests:** OT-01 (rate missing → status still PENDING, no ledger), OT-02 (double click → one row), OT-03 (forced failure after ledger insert → both rolled back).

### A4 — Annual plan: disable purchase now (P7)
- **Goal:** no ANNUAL_PLAN invoice can be created or paid until PLAN_GRANT exists.
- **Files:** `lib/validation/billing.ts:6` (plan create keeps ANNUAL for drafts? — proposal: refuse creating ANNUAL plans too), `app/api/invoices/route.ts` (refuse `packageType ANNUAL_PLAN` → 409 `ANNUAL_PLAN_DISABLED`), `app/api/invoices/[id]/checkout/route.ts` (refuse checkout of an existing ANNUAL invoice → same 409), `lib/payments/settlement.ts` (defence in depth: a signed success for an ANNUAL invoice → `ignored` + Admin flag, no subscription), UI: hide the ANNUAL option in `admin-billing-panel.tsx:142` and `admin-invoices-panel.tsx:105`.
- **Data model:** none. Existing demo ANNUAL invoices/subscriptions: listed for the owner, not touched.
- **Tests:** AN-01..AN-03 (create 409, checkout 409, webhook ignored).

### A5 — Payroll adjustments/disbursements idempotency (P13) and P8/P9 small fixes
- **P13:** `POST /api/payroll/adjustments|disbursements` accept a client `Idempotency-Key` header (uuid); migration adds `payroll_ledger.idempotency_key UUID NULL` + partial unique `WHERE idempotency_key IS NOT NULL`; a duplicate key → 200 with the existing row; currency must equal the teacher's rate currency → 409 `CURRENCY_MISMATCH`. Same-origin check (B3 batch 1).
- **P9:** catch P2002 on the per-session teacher credit inside the seam → treat as "already credited", continue the student side (documented rule CONTEXT §7).
- **P8:** no subscription at settlement → settle the teacher side, write no deduction, enqueue `BALANCE_NEGATIVE`-style Admin flag (`SETTLED_WITHOUT_SUBSCRIPTION`); no reservation → consume by the documented order (earliest-expiring first) instead of "latest".
- **Tests:** PR-01..PR-04, SS-01..SS-03.

### B1 — Secrets (e)
- **Facts (scan 2026-10-25, all refs, file + commit only):** no `.env*` file other than `webapp/.env.example` was ever committed; no API keys, tokens, JWTs, `postgres://user:pass@` URLs, Paymob/OpenWA/Cloudinary/Supabase/NextAuth secret values in any commit. `.env.example` history carries only non-secret values (`NEXTAUTH_URL` = localhost, `PAYMOB_API_URL` = public Paymob host, `SUPABASE_STORAGE_BUCKET` = bucket name). **The one real exposure:** the demo password literal in `webapp/prisma/seed-demo.ts` (`DEMO_PASSWORD`, since `16cc458`, still at HEAD), applied by the seed to every demo user **and to the Admin account** (`seed-demo.ts:307-310`) and printed by the seed (`:1121`). The repo is public, so anyone can read it: any database seeded with it (the dev DB today) has an Admin whose password is public. Exposure is real only if that DB/app is reachable by others or the password is reused elsewhere.
- **Plan:** seed reads `SEED_DEMO_PASSWORD` from env (required; abort if missing or < 12 chars); the seed NEVER changes the Admin account's password (the Admin keeps `SEED_ADMIN_PASSWORD` from the base seed); stop printing the password. History rewrite is NOT proposed (public forks/caches keep it anyway) — **rotate instead:** owner changes the dev Admin password now, never reuses that value. Add `SEED_DEMO_PASSWORD` to `.env.example`.
- **Tests:** SEC-01 (seed aborts without env), SEC-02 (admin hash unchanged by the demo seed).

### B2 — `?type=constructor` and user-input object indexing (S2, f)
- **Files:** `app/api/admin/profiles/route.ts:21-22,40-41`: `type` parsed by `z.enum(["student","guardian","teacher"])` and looked up in a `Map` (or guarded by `Object.hasOwn`); unknown → 400 `VALIDATION_ERROR`.
- **Sweep result:** server-side, the only object indexed with raw request input is `roleConfig[type]` (both handlers). Other `[key]` lookups found are client components or keys from our own constants (`NAV_BY_ROLE[role]` uses the session role; `apply-role-cards.tsx` constant config; `payments/audit.ts` iterates its own allowlist). Re-run the sweep at implementation time.
- **Tests:** AP-01 (`constructor`, `__proto__`, `toString` → 400), AP-02 (Supervisor never receives Admin/Supervisor rows).

### B3 — Same-origin helper for the 37 mutating routes (S1, g)
- **Helper:** `requireSameOrigin(request): NextResponse | null` in `lib/request.ts` (wraps the existing `isSameOrigin`; returns 403 `{error:{code:"CROSS_ORIGIN"}}`). Exempt by design: `POST /api/payments/webhook`, `POST /api/whatsapp/status` (signed server-to-server), `/api/auth/*` (NextAuth has its own CSRF token).
- **Batches (one commit each):** 1 money — invoices create/confirm/proofs/checkout, payroll adjustments/disbursements, teacher-rates, billing plans/rates/pay-per-session, overtime; 2 admin — admin/users, profiles, assignments, enrollments, teacher-subjects, settings/class-remarks, subjects; 3 operations — sessions (create/patch/link/replacement/recurrences), session-requests review, reports review, applications approve/review; 4 the rest — monthly-reports, report submit, attachments, notifications badge POST, evaluations (already has it — verify).
- **Prerequisite:** `ALLOWED_ORIGINS` must be set in production or every mutation fails closed (now in `.env.example`).
- **Tests:** SO-01 (each batch: cross-origin 403, same-origin OK, missing Origin 403), SO-02 (webhooks unaffected).

### B4 — Forced password change after an admin-set password (S9, owner answer 5)
- **Rule:** when an Admin sets/resets the password of an ADMIN, SUPERVISOR or TEACHER account, `must_change_password = true` (students/guardians: Phase 9). Self-service change clears it (existing flow).
- **Files:** `app/api/admin/users/route.ts:53`, `app/api/admin/users/[id]/route.ts:59`, the teacher password path in the profiles route.
- **Data model (additive, migration file only):** `users.password_set_by_id UUID NULL FK→users RESTRICT`, `users.password_set_at TIMESTAMPTZ NULL` — who/when last set it administratively (audit; no password data). No index needed.
- **Tests:** PW-01..PW-03 (admin-set → forced change for the three roles; student unchanged; self-change clears).

### B5 — Finance wall single helper + pay-per-session limits (S6, S7)
- One `assertFinanceAccess(user)` used by checkout, invoices, proofs and the student invoices page (rule CONTEXT §12: a student WITH a guardian has no finance access; adult without guardian has). `POST /api/invoices` enforces `getPayPerSessionConfig` min/max → 400 `PAY_PER_SESSION_OUT_OF_RANGE`. Tests FW-01..FW-03.

### C — Performance (h) — measure before and after every change
- **Method:** same machine, warm cache, 5 repeat loads per page (`/ar/admin`, `/ar/teacher`, `/ar/teacher/sessions`, `/ar/guardian`, landing); record server time from the dev log + DB round-trip count (Prisma query log, counts only — never log query params, they can contain student data).
- **C1 pg Pool:** `new Pool({ connectionString, max: 10, idleTimeoutMillis: 300_000, keepAlive: true, connectionTimeoutMillis: 10_000 })` in `lib/prisma.ts:13`. Rationale: the 10 s default idle timeout (`pg-pool` default) forces frequent reconnects (~280 ms each incl. DNS + TLS); during the DNS failures seen in Stage 1 every reconnect became a multi-second stall. Check that the Supabase transaction pooler's own idle limit is above 300 s; otherwise use 60 s.
- **C2 `relationJoins`:** Prisma here is **7.10** with the TS query compiler + `@prisma/adapter-pg` (`provider = "prisma-client"`). The generated client has no `relationLoadStrategy` today. Before enabling: read the Prisma 7.10 docs for relation joins with driver adapters (whether it is still a preview flag, GA/default, or unsupported with the query compiler) and the behaviour change (LATERAL JOIN + JSON aggregation in ONE query, different memory profile, `relationLoadStrategy: "query"` opt-out). Enable only if supported, then re-measure.
- **C3** single icon-font source (drop the remote Material Symbols CSS, `display=swap`); **C4** scoped client messages; **C5** indexes `invoices(student_id, created_at)`, `notification_jobs(recipient_user_id, read_at)` (partial index already exists — verify before adding), `teacher_flags(academy_id, flag_type)` — one migration file; **C6** `/teacher/sessions` date bound (today − 7 d … + 30 d, order asc) — fixes the "oldest 100" correctness bug; **C7** `instrumentation.ts` starts the worker without awaiting the graph (`void import(...)`).
- **C8** `npm cache clean --force` (owner-approved) once, before measuring.
- **Tests:** PF-01 (teacher sessions shows today's sessions with >100 older ones).

### D — Schema drift + docs
- `prisma/schema.prisma`: `@db.VarChar(n)` on `payment_audit.event_type/actor_role`, `session_evaluations.comment`; `map:` names for the ~15 hand-named FKs/indexes; DESC index definitions — goal: `prisma migrate diff --from-schema-datamodel … --to-url DIRECT_URL` prints no changes. No DB change.
- `docs/specs/database-schema.md`: add `payment_audit`, `session_evaluations`, `notification_jobs.read_at` + delivery columns, `admin_messages`, storage columns.

### E — Admin payment-link message (i) — DESIGN ONLY
- **Who:** ADMIN only (Supervisor never touches money; 403).
- **Recipient (finance wall):** the student's guardian if the student has one, otherwise the adult student. Never a student with a guardian.
- **Message:** amount (formatted from minor units + currency), invoice description/plan name, due date, and a link to the **platform invoice page** (`/<locale>/guardian/invoices/<id>` or `/<locale>/student/invoices/<id>`) — login required (option A), reuses the existing checkout and the finance wall. Never card data, never a Paymob URL, never a payment token.
- **API:** `POST /api/admin/invoices/:id/send-link` — same-origin, Zod `{ locale?: "ar"|"en" }`, invoice must be PENDING in the Admin's academy → 201 `{jobId}`; 409 `INVOICE_NOT_PENDING`, 409 `RECIPIENT_NO_PHONE`, 429 `RATE_LIMITED`.
- **Rate limit (proposal):** max 1 link per invoice per 24 h and 3 per invoice in total — enforced by the job `dedup_key = INVOICE_LINK:<invoiceId>:<YYYY-MM-DD>` + a count of existing `INVOICE_LINK` jobs for the invoice (no new table).
- **Notification kind:** `INVOICE_LINK`, payload `{ invoiceId }` only; the worker composes amount/due date/link at send time (redaction rule kept); the row log shows kind + ids only.
- **Audit:** "link sent" needs a new `payment_audit.event_type` value `LINK_SENT` → the CHECK constraint changes → **migration needed** (alternative without migration: rely on the job row only — weaker, not append-only). Proposal: add `LINK_SENT` (actor ADMIN, metadata `{jobId}`).
- **Channel rule:** the invoice stays visible in the portal; WhatsApp is never the only channel (OpenWA can be banned).
- **Tests:** PL-01..PL-05 (Supervisor 403; student-with-guardian never a recipient; PAID invoice 409; second send same day blocked; message has no provider URL).

### F — PLAN_GRANT (annual plans) — DESIGN ONLY, not implemented until the owner confirms the rules
- **Rule as stated by the owner (to confirm):** an annual plan grants **8 sessions per month** (the plan's monthly allotment), **no rollover**, granted by the worker on each **monthly anniversary** of the subscription start.
- **Design:** the paid annual invoice creates ONE subscription (12-month term) with NO initial sessions; the worker (daily tick) finds annual subscriptions whose next anniversary ≤ now and writes, in ONE serializable transaction per grant: `subscription_ledger` `PLAN_GRANT` (+N) with `period_index` 1..12 + the matching `EXPIRY` of the previous period's unused sessions (no rollover). Idempotency: partial unique `subscription_ledger(subscription_id, period_index) WHERE entry_type = 'PLAN_GRANT'`. Anniversary in the payer's timezone? (question). Month-end edge (start on 31st → grant on the last day of shorter months).
- **Data model (later migration):** enum `PLAN_GRANT` on the ledger entry type, `subscription_ledger.period_index SMALLINT NULL`, `subscriptions.term_ends_at`, unique above; reservations keep working per period.
- **Questions:** confirm 8/month vs "the plan's monthly allotment"; anniversary vs calendar month; refund of an annual plan mid-term (refund rules OPEN); what happens to reservations made in month k for sessions in month k+1.

### J — Gap analysis (read-only, 2026-10-25)

| CONTEXT § | Topic | Status | Evidence / note |
|---|---|---|---|
| 1–3 | Business context, sources, brand | Partial | Brand tokens + Stitch UI applied; **logo files still missing** (`lib/site-config.ts` logo variations null) — needs owner assets |
| 4 | Roles + Supervisor boundary | Done | one permission map, Supervisor money-free (Phase 6 log 2026-10-18); verified in Stage 1 |
| 5 | Onboarding/auth | Partial | username login, forced change, rate limit done (Phase 1); **admin-set password does not force a change for Admin/Supervisor** (B4); credentials via WhatsApp now addressable (W1/W2) |
| 6 | Live sessions, trust model, notification chain | Done/Partial | manual links, join window, click log, reminders, late-report chain done; **9.10 30-min window and 9.11 daily schedule not built** (Phase 9) |
| 7 | Financial model (credits, settlement, payroll) | Partial | settlement seam + ledgers + triggers done; **P5/P6/P8/P9 open (A2/A3/A5)**; annual PLAN_GRANT missing (F) — needs owner decision |
| 7 | Payroll side: hourly rates | Done | `app/api/admin/teacher-rates/route.ts` (effective-dated) |
| 7 | Payroll: teacher statements | Partial | `app/[locale]/teacher/payroll` (ledger view); no monthly statement/export — needs owner decision (format) |
| 7 | Payroll: monthly close + payouts | Partial | `app/api/payroll/disbursements` exists; **no "close month" step**, no idempotency (A5) — needs owner decision on the close workflow |
| 8 | WhatsApp | Partial | full channel built this session (unverified live); opt-in/consent missing (launch gap) |
| 9 | Reports + monthly reports + evaluations | Done (unverified) | Session 1–4 logs; tests deferred |
| 10 | Stack / worker | Partial | DB-polling worker via `instrumentation.ts`; hosting undecided |
| 11 | Single tenant | Done | `academy_id` on tenant tables; child tables without it (SaaS hygiene only) |
| 12 | Student payment, finance wall | Partial | wall enforced per route, inconsistent (B5); online payment **not safe yet** (A1) |
| 13 | Phases | — | Phase 7 Not Started: **announcements, complaints, admin evaluation summaries missing** (`phase-07` tasks unchecked) |
| 14 | Timeline / stages | Missing | stage boundaries OPEN — needs owner decision |
| 15–16 | Learning path, success | n/a | — |
| 17 | Decisions/env | Partial | Dodo vs Xpay CONFLICT still open; `.env` duplicates (OPENWA_*) |
| 18 | MVP cut line | Done | documented |
| 19 | SaaS roadmap | Done (doc only) | — |
| 20 | Gateways + renewal (6b) | Partial/Missing | Paymob checkout + webhook (unsafe, A1); **provider-managed renewals not wired** (`BillingSubscription` written nowhere, P7); **USD gateway missing** — needs owner decision; **refunds missing** — needs owner decision; failed-renewal grace not wired |
| 21 | Dashboards UI/UX | Partial | role dashboards built; Phase 9 pages (calendar, performance, notifications inbox) not built |
| Phase 6b | renewal, grace, PLAN_GRANT, refund, USD | Missing | blocked on owner decisions (see questions) |

**Launch gaps not in the docs — MY SUGGESTION (agent), not owner decisions:**
1. **Deployment architecture:** the worker starts from `instrumentation.ts` inside the Next.js process and polls every 60 s — it needs ONE long-running Node process (`next start` on a VPS/container). On serverless (Vercel functions) it would not run, or run per instance. OpenWA needs an always-on host with a persistent session store. Decide: one VPS (web + worker + OpenWA) vs web on a platform + a separate worker process.
2. **Single worker instance:** two app instances = two workers; claims are atomic, but spacing/ban protection assumes one — run the worker as one process.
3. **Supabase backups:** confirm the plan's backup/PITR level and do one restore drill before real data.
4. **Error monitoring/alerting:** none today (console only). Add a monitor (e.g. Sentry) with PII scrubbing; alert on webhook 5xx and FAILED-job spikes.
5. **Privacy/consent for minors + WhatsApp opt-in:** parental consent record, a WhatsApp opt-in/opt-out per user, privacy policy + terms written by the academy.
6. **Data retention:** how long to keep reports, attachments, notification rows, webhook events, `admin_messages`; deletion requests.
7. **Secrets rotation before launch** (already an action item) + `ALLOWED_ORIGINS` and `NODE_ENV=production` set, `OPENWA_SEND_ALLOWLIST` unset.
8. **Admin visibility of failed WhatsApp sends** (a FAILED-jobs list on `/admin/whatsapp`).

### Decisions needed from the owner (do not assume)
1. PLAN_GRANT rules (F): 8/month or the plan's allotment; anniversary vs calendar month; timezone; month-end rule.
2. Refund rules: full or partial; what happens to sessions already used/reserved.
3. USD gateway: Dodo vs Xpay vs postponed (CONTEXT §17 conflict).
4. Does a Paymob **MOTO** integration exist in your dashboard?
5. A2: refuse MISSED sessions too (proposal yes)?
6. A4: also block creating new ANNUAL plans (proposal yes) or only invoices/checkout?
7. E: rate limit "1 per invoice per day, 3 in total" OK? New audit event `LINK_SENT` (migration) OK?
8. A0: should `db:clear:demo` also delete the two stale settings keys, or will you delete them by hand?
9. Phase 9.12: keep Supervisor access to Zoom links?
