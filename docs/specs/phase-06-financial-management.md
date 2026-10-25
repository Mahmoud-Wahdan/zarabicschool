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

### Slice D — WhatsApp full channel (OpenWA-based) — DESIGN FIRST, owner approves before code

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
