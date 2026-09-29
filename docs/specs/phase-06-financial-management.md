# Phase 6 — Financial Management

## Goal

Manual payment confirmation (Section 12) + automatic teacher payroll accrual (Section 7). (CONTEXT.md §13, Phase 6.)

Implement student billing with Supabase Storage proof uploads, the dual-ledger accounting architecture (`SubscriptionLedger` + `PayrollLedger`), multi-currency balance tracking, atomic post-report payroll execution, and BullMQ reconciliation.

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
   - **`PayrollLedger`:** Append-only teacher compensation ledger. Stores `hourly_rate_snapshot_minor` and `billable_seconds`. `created_by = NULL` for system events, `NOT NULL` for Admin manual adjustments.
4. **Atomic Financial Transaction (Automatic Zoom-Attendance Trigger):**
   - Condition: Zoom `meeting.ended` received (or REST reconciliation) $\rightarrow$ Teacher was present with $\ge 1$ student.
   - Billable time is calculated (overlap between teacher & student), rounded to the minute, and capped at scheduled session duration.
   - In a single database transaction:
     1. Deduct 1 session from `SubscriptionLedger` (`SESSION_DEDUCTION`) for each attending student (attended $\ge 25\%$ duration).
     2. Credit teacher in `PayrollLedger` (`SESSION_CREDIT`) = billable hours $\times$ `hourly_rate_minor`.
     3. Set `Sessions.financially_settled_at = now()`.
   - Missed sessions have **0 financial effect**. Replacement sessions trigger this transaction when completed. Overtime beyond scheduled duration is noted in teacher's report and credited by Admin via `ADMIN_ADJUSTMENT`.
5. **Multi-Currency & Teacher Balance Tracking:**
   - No automatic currency conversion in MVP.
   - Teacher dashboards show accrued earnings categorized by currency (e.g. USD balance, EGP balance).
   - Admin manages manual currency conversion and logs payout disbursements (`DISBURSEMENT`).
6. **Reconciliation & Low-Balance Automation:**
   - BullMQ worker polls Zoom REST API to reconcile missed events during WebSocket outages.
   - Low-balance trigger fires warning notification when approximately 75% of purchased sessions are used (25% balance remaining).

## Tasks

- [ ] Add Prisma schema: `Subscriptions`, `SubscriptionLedger`, `Invoices`, `PaymentProofs`, `PayrollLedger`
- [ ] Configure PostgreSQL unique partial index on `PayrollLedger (session_id, student_id)`
- [ ] Run migrations
- [ ] Set up private Supabase Storage bucket for payment proofs & signed URL generator
- [ ] Build student/guardian invoice payment proof upload form
- [ ] Build Admin invoice verification and confirmation workflow (`INITIAL_PURCHASE` credit)
- [ ] Implement atomic financial processor (deduct `SubscriptionLedger` + credit `PayrollLedger` on session report submission)
- [ ] Build multi-currency teacher earnings breakdown UI (per-currency balances)
- [ ] Build Admin payroll review, manual adjustment, and disbursement approval views
- [ ] Implement BullMQ scheduled reconciliation worker using Zoom REST API
- [ ] Implement 75% usage low-balance alert trigger via WhatsApp (OpenWA)
- [ ] Write tests: transaction atomicity, double-spend prevention, dual-ledger balance calculations, idempotent replay rejection

## Execution log (updated as soon as real work happens)

(empty for now)
