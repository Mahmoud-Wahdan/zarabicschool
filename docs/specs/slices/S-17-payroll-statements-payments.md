# S-17 — Teacher payroll statements and payments (Part D, D85, D86; advances removed by D94)

> **Design and SQL only. Waiting for the owner's explicit OK. FINANCIAL (`payroll_ledger`). Nothing is built
> or applied.** Rules R1–R8: `phase-09-decisions.md` D86.
>
> **Advances (سلفة) are NOT in the MVP (D94, owner 2026-10-30).** There is no table, enum value, route, screen
> or test for them, and none was ever built or migrated. Money the Academy lends outside the system is recorded
> with the existing entries only: a DISBURSEMENT when it is paid out, and an ADMIN_ADJUSTMENT when it is repaid,
> each with a written reason (CONTEXT §18).

## What exists (read 2026-10-30)

- `payroll_ledger` is append-only: the trigger `payroll_ledger_append_only` refuses UPDATE and DELETE.
- **Entry types:**
  - SESSION_CREDIT: written on report approval; positive; carries a rate snapshot; one per session (partial unique index).
  - ADMIN_ADJUSTMENT: categories BONUS, FINE, OVERTIME, OTHER, with a reason. A reversal is an opposite entry (D83).
  - DISBURSEMENT: negative; Admin only; `idempotency_key` unique when set; currency = the teacher's rate currency.
- **Missing today:** a balance check on a disbursement, a payment method, and "the month it covers".
- The teacher balance is the sum of the teacher's rows (one currency per teacher, R7).
- The academy has no time-zone column. R1 uses a new setting `academy.timezone` (default `Africa/Cairo`; no SQL).

## Design

### The month a row belongs to (R1, R6)

- **SESSION_CREDIT:** the month of the session's `scheduled_start` in the academy zone, derived through the
  session, so no column is needed.
- **Every manual row (ADMIN_ADJUSTMENT, DISBURSEMENT):**
  - stores `statement_month` (`YYYY-MM`), the month it concerns, chosen by the Admin (default: the current month);
  - `created_at` stays the date it was made (R6: no month closing; a correction is a new entry);
  - older manual rows without a month are placed by their `created_at` month and labelled "earlier entry".
- **"Approved after the statement was issued" (R1):** month M's statement counts as issued at the payday of
  month M+1 (R2, academy zone). A SESSION_CREDIT for month M whose `created_at` is after that moment is listed
  in M and marked late. Nothing is stored for this.

### Payments (R2–R5)

- **Setting and reminder:**
  - `academy_settings` key `payroll.payday` (day 1–28, default 5; Admin only).
  - The worker sends the Admins `PAYROLL_PAYDAY` (in-app + WhatsApp, no amounts) once a month on the payday at
    09:00 academy time. The dedup key is the month.
- **`POST /api/payroll/payments`** (Admin only, same-origin, a UUID `Idempotency-Key` header required):
  - body `{ teacherId, amountMinor > 0, method: CASH|BANK_TRANSFER|INSTAPAY|WALLET, reference?: ≤100, statementMonth: YYYY-MM, reason: 2..500 }`;
  - stored as a DISBURSEMENT with `-amountMinor`.
- **The balance check (R4), all in ONE transaction:**
  1. `SELECT id FROM teachers WHERE id = $teacher AND academy_id = $academy FOR UPDATE`. The teacher row is the
     lock for that teacher's ledger.
  2. Idempotency: an existing row with the same key is replayed with 200, or refused with 409 `IDEMPOTENCY_KEY_REUSED`
     if the body differs (the existing A5 helper).
  3. `balance = SUM(amount_minor)` of the teacher's rows, read under the lock.
  4. Refuse 409 `PAYMENT_EXCEEDS_BALANCE` when `amount > balance`. A balance ≤ 0 therefore refuses every payment.
     A FINE may make the balance negative (D92); the confirmation step warns about it.
  5. Insert the DISBURSEMENT row.
  - Partial payments are allowed. The currency must equal the teacher's rate currency (as today).
- **After commit:** a `PAYROLL_PAYMENT_RECORDED` notice to the teacher (in-app + WhatsApp). The text has **no
  amount**: "A payment for October 2026 was recorded; details are on your payroll page."
- **Old route:** `POST /api/payroll/disbursements` is retired once the payments form is live (D92). The Admin
  panel switches to `/api/payroll/payments`, and the old route answers 410 `USE_PAYMENTS`.

### Statement (R5)

- **`GET /api/payroll/statements?teacherId=&month=YYYY-MM`:**
  - a teacher reads their own statement only (any other `teacherId` gives 404);
  - the Admin reads any teacher of the academy;
  - the Supervisor gets 403 (R8).
- **Computed from the ledger (R6), never stored:**
  - sessions: date, student or "Group (n)", minutes and amount, from that month's credits with the late flag;
  - total hours;
  - bonuses, overtime, fines (with reasons) and other adjustments tagged to that month;
  - payments tagged to that month, with method and reference;
  - **remaining for the month** = the sum of every row whose month is ≤ that month, so it includes unpaid
    earlier months; the balance today is shown separately.
- **Pages:** `/teacher/payroll` gets a month picker with the statement; `/admin/payroll` gets a per-teacher
  statement view. Both use the academy zone and say so.

### Why the money is safe (the reasoning asked for)

- **Append-only:**
  - Payments and corrections are new rows; the existing trigger refuses UPDATE and DELETE on `payroll_ledger`.
  - Adding nullable columns changes no existing row, so the trigger never fires and history is untouched.
  - The two "required on new rows" checks are `NOT VALID`: they apply to every new row but do not re-check the
    old ones, which cannot be edited anyway.
- **No overpayment:**
  - The balance is read and the row inserted under one `FOR UPDATE` lock on the teacher row.
  - Two simultaneous payments for one teacher wait for each other, and the second sees the first one's row.
  - Without the lock, both could read the same balance under READ COMMITTED (write skew) and together exceed it.
- **Idempotency:**
  - `payroll_ledger_idempotency_key_key` (unique when set) already exists.
  - A double click or a network retry with the same key returns the first row, never a second payment.
- **Rollback:**
  - The payment is one INSERT in one transaction; any failure (check, lock timeout, constraint) writes nothing.
  - The teacher notice is queued after commit, so a failed send never undoes a payment.
- **Supervisor:** no payroll route accepts the SUPERVISOR role, so no amount can reach them (R8).

## SQL S-12 (proposed) — one migration file `20261030120000_payroll_statement_month_payments`

```sql
-- Which month a manual payroll row concerns (R6), and how a payment was made (R3).
ALTER TABLE "payroll_ledger" ADD COLUMN "statement_month" CHAR(7);
ALTER TABLE "payroll_ledger" ADD COLUMN "payment_method" VARCHAR(16);
ALTER TABLE "payroll_ledger" ADD COLUMN "payment_reference" VARCHAR(100);

ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_statement_month_format_check"
  CHECK ("statement_month" IS NULL OR "statement_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
-- Method and reference exist only on payments.
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_payment_method_check"
  CHECK ("payment_method" IS NULL OR ("entry_type" = 'DISBURSEMENT' AND "payment_method" IN ('CASH', 'BANK_TRANSFER', 'INSTAPAY', 'WALLET')));
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_payment_reference_check"
  CHECK ("payment_reference" IS NULL OR "entry_type" = 'DISBURSEMENT');
-- Every NEW manual row names its month, and every NEW payment its method. NOT VALID:
-- existing rows (append-only, untouchable) are not re-checked; every new row is.
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_manual_month_check"
  CHECK ("entry_type" = 'SESSION_CREDIT' OR "statement_month" IS NOT NULL) NOT VALID;
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_payment_method_required_check"
  CHECK ("entry_type" <> 'DISBURSEMENT' OR "payment_method" IS NOT NULL) NOT VALID;

CREATE INDEX "payroll_ledger_teacher_month_idx" ON "payroll_ledger"("teacher_id", "statement_month");
```

- **Not in this SQL (D94):** no `ADVANCE` enum value, no `teacher_advance_requests` table, no `advance_request_id` column.
- **Code that must change together with the migration:** the existing adjustment and reversal routes must send
  `statement_month`, or the `NOT VALID` check refuses them. They default it to the current month in the
  academy zone, and the reversal copies the original row's month.
- **Pre-flight before applying (read-only):** the count of rows per entry type. Nothing changes for them.

## Tests (PS-01..10, written first)

- PS-01: a session on 31 Oct 23:30 Cairo (21:30 UTC) is in October; one on 1 Nov 00:30 Cairo is in November.
- PS-02: an October session approved on 7 Nov (after payday 5) is in October's statement, marked late.
- PS-03: a payment above the balance gets 409 and writes nothing; a partial payment is OK.
- PS-04: two concurrent payments whose sum exceeds the balance: exactly one is written.
- PS-05: the same `Idempotency-Key` twice gives one row and a 200 replay; the same key with a different body gives 409.
- PS-06: after a FINE makes the balance negative, a payment gets 409; after enough credits it works again.
- PS-07: teacher A cannot read teacher B's statement (404).
- PS-08: the Supervisor gets 403 on statements and payments; no amount appears in any Supervisor payload.
- PS-09: the WhatsApp text of the payment notice has no amount and no currency.
- PS-10: the DB refuses a new DISBURSEMENT without a method, a new manual row without a month, and a method on a non-payment row.
- PS-11: the payday reminder fires once per month at the academy's local payday.
- PS-12: the old disbursements route answers 410.
