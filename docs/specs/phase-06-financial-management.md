# Phase 6 — Financial Management

## Goal

Manual payment confirmation (Section 12) + automatic teacher payroll accrual (Section 7). (CONTEXT.md §13, Phase 6.)

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
2. **Student Manual Billing & Supabase Storage:**
   - Invoices generated with integer minor units and ISO currency codes for prepaid packages (no expiry date).
   - Students/guardians upload receipt files directly to private **Supabase Storage** bucket.
   - Database stores `file_path`. Admin accesses proofs via short-lived signed URLs.
   - When Admin marks invoice `PAID`, system inserts `INITIAL_PURCHASE` row (+N sessions) into `SubscriptionLedger`.
3. **Dual-Ledger Financial Engine:**
   - **`SubscriptionLedger`:** Remaining student balance is calculated from append-only rows (`INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND`).
   - **`PayrollLedger`:** Append-only teacher compensation ledger. Stores scheduled `minutes_credited` and `hourly_rate_snapshot_minor`. `created_by = NULL` for system entries, `NOT NULL` for Admin manual adjustments.
4. **Approval-gated atomic settlement:**
   - After Admin approves an attended report, record one `SESSION_DEDUCTION` for that student and one `SESSION_CREDIT` for the session.
   - Use scheduled duration and the rate snapshot; later reports cannot create another session credit.
   - The same transaction sets `Reports.settled_at` and `Reports.archived_at`.
   - Any failure rolls back both ledger effects and report markers; retry is safe through idempotency constraints.
   - Missed sessions have **0 financial effect**. Replacement sessions trigger this transaction when completed. Overtime beyond scheduled duration is noted in teacher's report and credited by Admin via `ADMIN_ADJUSTMENT`.
5. **Multi-Currency & Teacher Balance Tracking:**
   - No automatic currency conversion in MVP.
   - Teacher dashboards show accrued earnings categorized by currency (e.g. USD balance, EGP balance).
   - Admin manages manual currency conversion and logs payout disbursements (`DISBURSEMENT`).
6. **Consistency:** Query for approved/archived reports without ledger rows and ledger rows without a settled report. Low-balance alerts are deferred.

Delivery stage: Stage 3.

## Acceptance criteria

- Approved-report settlement atomically writes one deduction, one first-session credit, `Reports.settled_at`, and `Reports.archived_at`; duplicate/concurrent requests are safe.
- Teacher credit never fails because a package is empty; Admin is flagged for negative balance.

## Frontend

Routes: `/student/invoices`, `/guardian/invoices`, `/admin/invoices`, `/teacher/payroll`, `/admin/payroll`, `/admin/overtime`. Include upload/loading/empty/error states, per-currency balances, mobile RTL, and role visibility.

## Backend

POST `/api/invoices/:id/confirm`, POST `/api/reports/:id/settle`, POST `/api/payroll/adjustments`, POST `/api/payroll/disbursements`, POST `/api/reports/:id/overtime/approve`. Zod schemas, consistent errors, conditional overtime claim, and post-commit notifications.

## Database

Touches `Subscriptions`, both ledgers, `Invoices`, `PaymentProofs`, `Reports`, and recommended `TeacherRates`. Partial indexes, checks, append-only triggers, and `ON DELETE RESTRICT` require raw SQL migrations.

## Auth & Authorization

| Role | Upload proof | Confirm invoice | Submit settlement | Approve overtime | View payroll |
|---|---:|---:|---:|---:|---:|
| Student/Guardian | Own | No | No | No | Own permitted view |
| Teacher | No | No | Own report | No | Own |
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

- [DEFERRED] Low-balance alerts, payment gateways, Zoom reconciliation, and overlap-based billing.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [ ] Add Prisma schema: `Subscriptions`, `SubscriptionLedger`, `Invoices`, `PaymentProofs`, `PayrollLedger`
- [ ] Configure PostgreSQL unique partial index on `PayrollLedger (session_id)` for `SESSION_CREDIT`
- [ ] Run migrations
- [ ] Set up private Supabase Storage bucket for payment proofs & signed URL generator
- [ ] Build student/guardian invoice payment proof upload form
- [ ] Build Admin invoice verification and confirmation workflow (`INITIAL_PURCHASE` credit)
- [ ] Implement Admin approval-gated settlement processor (deduction + first credit + report markers in one transaction)
- [ ] Build multi-currency teacher earnings breakdown UI (per-currency balances)
- [ ] Build Admin payroll review, manual adjustment, and disbursement approval views
- [ ] REMOVED — BullMQ scheduled Zoom reconciliation worker.
- [ ] Implement 75% usage low-balance alert trigger via WhatsApp (OpenWA)
- [ ] Write tests: transaction atomicity, double-spend prevention, dual-ledger balance calculations, idempotent replay rejection

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom reconciliation, event processing, overlap-based billing, and `Sessions.financially_settled_at`.
- [MVP] Only an approved report can settle; successful settlement archives the original immutable report.
- BLOCKED — TeacherRates storage, rounding, and the zero-session scheduling mechanism remain owner decisions.
