# S-17 — Teacher payroll statements, payments and advances (Part D, D85–D87)

> **Design and SQL only — waiting for the owner's OK. FINANCIAL (`payroll_ledger` + a new table).
> Nothing is built or applied.** Rules R1–R8 and the advance rules: `phase-09-decisions.md` D86/D87.

## What exists (read 2026-10-30)

- `payroll_ledger` is append-only (`prevent_ledger_mutation`). Its entry types:
  - **SESSION_CREDIT:** written on report approval; positive; rate snapshot; one per session.
  - **ADMIN_ADJUSTMENT:** BONUS / FINE / OVERTIME / OTHER, with a reason; reversal = an opposite entry (D83).
  - **DISBURSEMENT:** negative; Admin only; idempotency key; currency = the teacher's rate currency.
- There is no balance check on a disbursement today, no payment method, no "month it covers", and no advances.
- The teacher balance is the sum of the teacher's rows (one currency per teacher, R7).
- The academy has no time-zone column. R1 uses a new setting `academy.timezone` (default `Africa/Cairo`, no SQL).

## Design

### Month of a row (R1, R6)

- **The statement month (`YYYY-MM`, academy zone) of each row:**
  - SESSION_CREDIT: the month of the session's `scheduled_start`, derived through the session, so no column is needed.
  - Every manual row (ADMIN_ADJUSTMENT, DISBURSEMENT, ADVANCE): stores `statement_month`, the month it concerns,
    chosen by the Admin. It defaults to the current month and is required on new rows.
  - The row's `created_at` stays the date it was made (R6: no month closing, a correction is a new entry).
- **"Approved after the statement was issued" (R1):** a month's statement counts as issued on its payday
  (R2: payday P of the next month, academy zone). A SESSION_CREDIT whose `created_at` is after that moment is
  listed in its own month and marked late. Nothing is stored for it.

### Payments (R2–R5)

- **Payday setting:** `academy_settings` key `payroll.payday` (day 1–28, default 5; Admin only).
- **Payday reminder:** the worker sends the Admins `PAYROLL_PAYDAY` (in-app + WhatsApp, no amounts) once per month
  on the payday, at 09:00 academy time. The dedup key is the month.
- **`POST /api/payroll/payments`** (Admin only, same-origin, `Idempotency-Key` UUID required):
  - body: `{ teacherId, amountMinor > 0, method: CASH|BANK_TRANSFER|INSTAPAY|WALLET, reference?: ≤100, statementMonth: YYYY-MM, reason: 2..500 }`;
  - it is written as a DISBURSEMENT, stored negative.
- **R4, one transaction:**
  1. `SELECT … FROM teachers WHERE id = $teacher FOR UPDATE`. The teacher row is the ledger mutex, so concurrent
     payments for one teacher serialize.
  2. Balance = SUM(amount_minor) of the teacher's rows.
  3. Refuse 409 `PAYMENT_EXCEEDS_BALANCE` if amount > balance. This also covers a negative balance from an advance:
     a balance ≤ 0 refuses every payment.
  4. Insert.
  - Partial payments are allowed. The currency must equal the rate currency (as today).
- **After commit:** a `PAYROLL_PAYMENT_RECORDED` notice to the teacher, in-app and WhatsApp. The text carries
  **no amount**: "A payment for October 2026 was recorded. Details are on your payroll page."
- The existing `/api/payroll/disbursements` route keeps working but gains the same balance check, and the
  payroll panel moves to `/payments`. Proposal: retire the old route after the UI switch.

### Statement (R5)

- `GET /api/payroll/statements?teacherId=&month=YYYY-MM`
  - **Who:** a teacher only for themself (another `teacherId` is 404); Admin for any teacher of the academy;
    Supervisor gets 403 (R8).
- **Computed from the ledger (R6):**
  - sessions: date, student or "Group (n)", minutes and amount, from that month's credits with a late flag;
  - total hours;
  - bonuses, overtime, fines (with reasons) and other adjustments tagged to that month;
  - advances tagged to that month;
  - payments tagged to that month;
  - **remaining** = the running balance at the end of that month's rows. The balance today is shown separately.
- **Pages:** `/teacher/payroll` gets a month picker with the statement, `/admin/payroll` a per-teacher statement view.
  Both are in the academy zone and say so. Proposal: a PDF/print export later.

### Advances (سلفة, D87)

- **Teacher:** `POST /api/payroll/advance-requests` (TEACHER, same-origin) with `{ amountMinor > 0, reason: 5..500 }`
  in the teacher's currency.
  - At most one PENDING request per teacher; a second gets 409 `ADVANCE_REQUEST_OPEN`.
  - The Admins get an in-app notice `ADVANCE_REQUESTED`.
- **Teacher list:** `GET /api/payroll/advance-requests`. A teacher sees their own requests; the Admin sees all
  requests with a status filter.
- **Admin decision:** `POST /api/payroll/advance-requests/:id/decision` (ADMIN, same-origin) with
  `{ decision: APPROVE|REJECT, rejectionReason? }`, in ONE transaction:
  1. Lock the teacher row, then lock the request `FOR UPDATE`; it must be PENDING.
  2. **APPROVE:** status APPROVED, plus ONE `ADVANCE` ledger row with `-amount`, `advance_request_id`, the
     current `statement_month`, and the request's reason. A unique index makes a second approval impossible,
     and a replay answers 200 `alreadyHandled`.
  3. **REJECT:** status REJECTED with the reason required. No ledger row.
  - After commit, the teacher is told in-app and by WhatsApp, with no amount.
- **The balance may go negative only through an ADVANCE.** Payments refuse when the balance is ≤ 0 (R4), and
  fines, being Admin decisions, may also push it below zero. **Question for the owner:** should a FINE be
  allowed to make the balance negative?
- **Repayment is automatic:** later SESSION_CREDITs add to the balance. Nothing is scheduled; the statement shows
  "advance outstanding" while the balance is negative.
- The Supervisor never sees requests or amounts (R8).

## SQL S-12 (proposed) — two migration files, because Postgres cannot use a new enum value in the same transaction that adds it

**`20261030100000_payroll_advance_enum`**
```sql
ALTER TYPE "PayrollLedgerEntryType" ADD VALUE IF NOT EXISTS 'ADVANCE';
```

**`20261030110000_payroll_statements_payments_advances`**
```sql
-- Advance requests (new table).
CREATE TABLE "teacher_advance_requests" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "teacher_advance_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_advance_requests_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "teacher_advance_requests_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "teacher_advance_requests_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 500),
  CONSTRAINT "teacher_advance_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT "teacher_advance_requests_decision_check" CHECK (
    ("status" = 'PENDING'  AND "decided_by" IS NULL AND "decided_at" IS NULL AND "rejection_reason" IS NULL) OR
    ("status" = 'APPROVED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND "rejection_reason" IS NULL) OR
    ("status" = 'REJECTED' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND char_length(btrim("rejection_reason")) BETWEEN 2 AND 500)
  )
);
CREATE UNIQUE INDEX "teacher_advance_requests_one_open_key" ON "teacher_advance_requests"("teacher_id") WHERE "status" = 'PENDING';
CREATE INDEX "teacher_advance_requests_academy_status_idx" ON "teacher_advance_requests"("academy_id", "status", "created_at" DESC);
ALTER TABLE "teacher_advance_requests" ADD CONSTRAINT "teacher_advance_requests_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teacher_advance_requests" ADD CONSTRAINT "teacher_advance_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teacher_advance_requests" ADD CONSTRAINT "teacher_advance_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger columns (append-only table: new columns, new rows only).
ALTER TABLE "payroll_ledger" ADD COLUMN "statement_month" CHAR(7);
ALTER TABLE "payroll_ledger" ADD COLUMN "payment_method" VARCHAR(16);
ALTER TABLE "payroll_ledger" ADD COLUMN "payment_reference" VARCHAR(100);
ALTER TABLE "payroll_ledger" ADD COLUMN "advance_request_id" UUID;
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_advance_request_fkey" FOREIGN KEY ("advance_request_id") REFERENCES "teacher_advance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_statement_month_format_check" CHECK ("statement_month" IS NULL OR "statement_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_payment_method_check" CHECK ("payment_method" IS NULL OR ("entry_type" = 'DISBURSEMENT' AND "payment_method" IN ('CASH', 'BANK_TRANSFER', 'INSTAPAY', 'WALLET')));
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_payment_reference_check" CHECK ("payment_reference" IS NULL OR "entry_type" = 'DISBURSEMENT');
-- An ADVANCE is negative and always points at its approved request; one ADVANCE per request.
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_advance_check" CHECK (
  ("entry_type" <> 'ADVANCE' AND "advance_request_id" IS NULL)
  OR ("entry_type" = 'ADVANCE' AND "amount_minor" < 0 AND "advance_request_id" IS NOT NULL)
);
CREATE UNIQUE INDEX "payroll_ledger_one_advance_per_request_key" ON "payroll_ledger"("advance_request_id") WHERE "entry_type" = 'ADVANCE';
-- New manual rows must say which month they concern; NEW payments must carry a method. NOT VALID keeps
-- the existing (append-only, untouchable) rows as they are while every new row is checked.
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_manual_month_check" CHECK (
  "entry_type" = 'SESSION_CREDIT' OR "statement_month" IS NOT NULL
) NOT VALID;
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_payment_method_required_check" CHECK (
  "entry_type" <> 'DISBURSEMENT' OR "payment_method" IS NOT NULL
) NOT VALID;
CREATE INDEX "payroll_ledger_teacher_month_idx" ON "payroll_ledger"("teacher_id", "statement_month");
```
- **Existing checks that cover ADVANCE too:** `payroll_ledger_manual_reason_check` (reason) and
  `payroll_ledger_creator_check` (`created_by`). The append-only trigger is unchanged.
- **Old rows:** existing manual rows keep `statement_month` NULL. The statement places them by the month of their
  `created_at` and labels them "earlier entry".

## Tests (PS-01..12)

- PS-01: a session on 31 Oct 23:30 Cairo (= 21:30 UTC) counts in October; one on 1 Nov 00:30 Cairo counts in November.
- PS-02: an October session approved on 7 Nov (after payday 5) is in October's statement, marked late.
- PS-03: a payment above the balance gets 409 and no row; a partial payment is OK.
- PS-04: two concurrent payments whose sum exceeds the balance: exactly one is written.
- PS-05: approving an advance twice gives one ADVANCE row and a 200 `alreadyHandled` replay; a concurrent double
  approval also gives one row.
- PS-06: with a negative balance after an advance, a payment gets 409; after enough credits it works again.
- PS-07: a second open advance request gets 409; after a rejection a new request is OK.
- PS-08: teacher A cannot read teacher B's statement or requests (404).
- PS-09: the Supervisor gets 403 on statements, payments and advances, and no amount appears anywhere in a
  Supervisor payload (payroll pages, inbox).
- PS-10: the payment notice's WhatsApp text has no amount and no currency.
- PS-11: payday reminder: once per month, at the academy's local payday.
- PS-12: DB-level checks. An ADVANCE without a request, a positive ADVANCE, a new DISBURSEMENT without a method,
  and a new manual row without a month are each rejected by the DB.

## Questions for the owner

1. May a FINE make the balance negative, or only an advance? Recommended: allow it (it is an Admin decision),
   but show a warning in the confirmation step.
2. Is there a maximum advance (e.g. one month's average earnings)? Recommended: no automatic cap; the Admin decides.
3. Should the old `/api/payroll/disbursements` route be retired once the new payments form is live? Recommended: yes.
