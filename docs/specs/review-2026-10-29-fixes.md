# Review fixes B1–B4, login lockout, D80 — rules and SQL for the owner's OK

> Branch `fix/review-2026-10-29`. Source: the whole-code review of 2026-10-29 (chat) and the owner's
> instructions of the same day. **Nothing in this file is built yet.** Each item waits for the owner's
> OK; the SQL is shown as text only (new migration files, no BOM, the owner applies them).
> FINANCIAL = touches a money or attendance table.

## B1 — Refund holds the sessions at request time (FINANCIAL: `subscription_ledger`, `invoice_refunds`)

**Problem (verified):** `lib/billing/refunds.ts` writes the `REFUND −n` ledger row only on SUCCEEDED.
A PENDING answer, or a crash after the Paymob call, leaves the row PENDING forever, and the sessions stay
bookable (booking and expiry do not subtract pending refunds).

**Rule:**
1. **At request time:** in ONE transaction, the invoice and package locks, all checks, then the
   `invoice_refunds` row (PENDING) **and** a ledger row `REFUND −n` linked to that refund (the hold).
   From this moment the balance is lower, so booking, the expiry worker and the next refund all see the
   sessions as gone. No rule elsewhere needs to know about pending refunds (the `pendingSessions`
   subtraction in `requestRefund` is removed: the hold already counts).
2. **Paymob says SUCCEEDED:** the refund row becomes SUCCEEDED and `REFUNDED` is audited. No new ledger row,
   because the hold is the refund.
3. **Paymob refuses (FAILED):** the refund row becomes FAILED, `REFUND_FAILED` is audited, and a **reversing
   ledger row `ADMIN_ADJUSTMENT +n` linked to the same refund** gives the sessions back. Nothing is updated
   or deleted. If the package already EXPIRED meanwhile, the restored sessions are on a closed package:
   the row still stands, and the Admin is flagged (`REFUND_RESTORED_ON_CLOSED_PACKAGE`).
4. **Paymob PENDING, or a crash after the call:** the row stays PENDING **with the hold in place**, so no
   money and no sessions are double-used.
   - A bounded worker step re-checks it: at most 10 rows per tick, ordered by `next_check_at`, one Paymob
     call each, and a failure on one row never blocks the others.
   - Back-off: 5 min, 15 min, 1 h, 6 h, then daily up to 14 days. After that the row is flagged to the
     Admin once (`REFUND_STUCK`) and checked daily.
   - With a `provider_refund_id`, the worker retrieves that transaction and applies rule 2 or 3.
   - Without one (the crash case), nothing is decided automatically: the Admin is flagged at once, because
     money may already have left.
5. **Admin list:** a "Pending refunds" card on `/admin/invoices`, Admin only. It shows invoice, sessions,
   amount, age, last check and Paymob refund id, plus a link to the invoice.

**SQL S-10 (proposed):**
```sql
-- Link each hold / reversal to the refund that caused it (append-only rows keep this forever).
ALTER TABLE "subscription_ledger" ADD COLUMN "invoice_refund_id" UUID;
ALTER TABLE "subscription_ledger" ADD CONSTRAINT "subscription_ledger_invoice_refund_fkey"
  FOREIGN KEY ("invoice_refund_id") REFERENCES "invoice_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One hold per refund, one reversal per refund.
CREATE UNIQUE INDEX "subscription_ledger_one_refund_hold_key"
  ON "subscription_ledger"("invoice_refund_id") WHERE "entry_type" = 'REFUND';
CREATE UNIQUE INDEX "subscription_ledger_one_refund_reversal_key"
  ON "subscription_ledger"("invoice_refund_id") WHERE "entry_type" = 'ADMIN_ADJUSTMENT';
-- A refund link appears only on a hold (negative) or its reversal (positive).
ALTER TABLE "subscription_ledger" ADD CONSTRAINT "subscription_ledger_refund_link_check" CHECK (
  "invoice_refund_id" IS NULL
  OR ("entry_type" = 'REFUND' AND "sessions_delta" < 0)
  OR ("entry_type" = 'ADMIN_ADJUSTMENT' AND "sessions_delta" > 0)
);
-- Worker scheduling for PENDING refunds.
ALTER TABLE "invoice_refunds" ADD COLUMN "next_check_at" TIMESTAMPTZ(6);
ALTER TABLE "invoice_refunds" ADD COLUMN "check_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_check_count_check" CHECK ("check_count" >= 0);
CREATE INDEX "invoice_refunds_pending_next_check_idx" ON "invoice_refunds"("next_check_at") WHERE "status" = 'PENDING';
```
- **Existing rows:** older SUCCEEDED refunds keep their unlinked `REFUND` rows. There is no backfill (append-only).
- **Pre-existing PENDING refunds:** any PENDING refund without a hold gets one when the worker first sees it,
  in the same row-locked transaction. A pre-flight count is shown before applying; it is 0 in the test data.

**Paymob call to confirm in test mode:** retrieving a transaction by id
(`GET /api/acceptance/transactions/{id}` with the auth token, as the docs describe it). It is not exercised
yet, so it will be verified in the Layer 2 run.

**Tests (RF-09..14):**
- PENDING answer: the hold exists, the sessions cannot be booked, and the balance is lower.
- Crash after the Paymob call (the client throws after "sending"): the row stays PENDING with the hold, and the Admin is flagged.
- Refusal: a FAILED row plus the reversing +n entry; sessions are bookable again; no row was updated.
- Booking cannot use held sessions (`reserveCredit` returns false at exactly the held count).
- The same idempotency key twice gives one row, one hold, and a 200 replay.
- Worker: back-off, isolation (one failing row does not stop the next), PENDING to SUCCEEDED with no second ledger row.

## B2 — Reschedule checks the teacher's time and refuses after a report

**Rule:**
- `PATCH /api/sessions/[id]` with a time change runs in one transaction:
  1. Lock the session row `FOR UPDATE`.
  2. Re-read it. Refuse with 409 `SESSION_HAS_REPORTS` if any report of the session is SUBMITTED or APPROVED.
  3. Run `assertTeacherFree(tx, academy, teacher, newStart, newEnd, { excludeSessionId })`, then write.
- `assertTeacherFree` gains an optional `excludeSessionId`.
- The approval path's `FOR SHARE` lock conflicts with this `FOR UPDATE`, so an approval and a reschedule are serialized.
- Link-only and cancellation edits are unchanged.
- **Question for the owner:** should a **REJECTED** report (waiting for the teacher's correction) also block
  a time change? Recommended: **yes**. The report and its frozen outcome belong to the original time.

**Tests (RS-01..03):** overlapping slot gives 409 `TEACHER_TIME_CONFLICT`; a free slot gives 200 and moves the
pending notices; a change after a SUBMITTED report gives 409 with nothing changed. Plus moving the session
within its own old slot, which must not conflict with itself.

## B3 — Guardian switch allowed, never removed for a minor (D10)

**Rule:**
- `PATCH /api/admin/profiles/[id]` (Admin and Supervisor):
  - `guardianId` = another guardian **of the same academy**: allowed (unchanged).
  - `guardianId: null`: refused with 409 `GUARDIAN_REQUIRED` when the student is a minor (`is_adult = false`).
  - `guardianId: null` for an adult student: still allowed (an adult may pay for themself).
- The check runs inside the update transaction on the stored `is_adult`.

**Tests (GD-01..04):** Admin switch OK; Supervisor switch OK; Admin or Supervisor null for a minor gives 409 with
the guardian unchanged; a foreign-academy guardian gives 404. No SQL.

## B4 — Worker loops: stuck rows never block newer ones; next check stored in the DB (FINANCIAL: `subscriptions`, `billing_subscriptions`)

**Rule:**
- **Credit expiry:**
  - Select ACTIVE monthly/annual packages whose period has ended and whose `expiry_next_check_at` is NULL
    or due, ordered by that time (NULL first), at most 100 per tick.
  - A package left ACTIVE only because of live reservations gets `expiry_next_check_at = now + 6 h`.
  - **The reservation is skipped, never changed (D84).**
- **Renewal:**
  - `next_check_at` replaces the in-memory `lastSweepAt`. Select ACTIVE/PAST_DUE/INCOMPLETE subscriptions
    that are due, ordered by `next_check_at` (NULL first), at most 100.
  - After a sweep: +6 h while inside the grace period, +24 h after it, and +6 h for INCOMPLETE retries.
  - A restart therefore no longer resets the throttle, and stale PAST_DUE rows stop occupying the first 100 slots.
- **D84 Admin list:** "Reservations waiting for a report" (Admin + Supervisor, no money fields) on
  `/admin/sessions`. It shows RESERVED reservations whose session ended and whose package period ended,
  with the student, session time and teacher, and links to the session page (report or manual resolution).
  Read only.

**SQL S-11 (proposed):**
```sql
ALTER TABLE "subscriptions" ADD COLUMN "expiry_next_check_at" TIMESTAMPTZ(6);
CREATE INDEX "subscriptions_expiry_due_idx" ON "subscriptions"("expiry_next_check_at", "period_ends_at")
  WHERE "status" = 'ACTIVE' AND "package_type" IN ('MONTHLY_PLAN', 'ANNUAL_PLAN');
ALTER TABLE "billing_subscriptions" ADD COLUMN "next_check_at" TIMESTAMPTZ(6);
CREATE INDEX "billing_subscriptions_next_check_idx" ON "billing_subscriptions"("next_check_at")
  WHERE "status" IN ('INCOMPLETE', 'ACTIVE', 'PAST_DUE');
```
No ledger table changes. Existing rows start with NULL, so they are checked on the first tick.

**Tests (WK-01..05):**
- 101 packages with live reservations plus one newer drained package: the newer one expires in the first tick.
- The reservation row is byte-for-byte unchanged.
- 101 stale PAST_DUE subscriptions: a newer ACTIVE one is still swept.
- After a restart (a fresh module), the throttle holds because it is read from the DB.

## D80 — No new booking during the renewal grace (no SQL)

**Rule:**
- While a student has an automatic renewal in **PAST_DUE**, every new booking path refuses with
  409 `RENEWAL_PAST_DUE`: single session, series creation, enrollment, replacement and roster add.
- The worker's weekly series extension pauses the series, the same way as a lack of credit
  (an Admin `SERIES_PAUSED` notice).
- Sessions already booked stay. As soon as a verified renewal books the new period (status ACTIVE),
  booking works again.
- One check in `reserveCredit` / `hasAvailableCredit` (one query on `billing_subscriptions`), so every path is covered.
- **Question for the owner:** should a pay-per-session package the student also holds still be usable during
  the grace? D80 as written says "no new bookings", so the recommendation is **no**: block all new bookings.

**Tests (GR-01..04):** PAST_DUE refuses each booking path; a verified renewal unblocks; existing bookings are
untouched; the series pauses.

## Low — per-username lockout redesign (to show before building)

**Today:** five failed logins in 10 minutes for a username block that username from **every** address.
Anyone can lock a teacher out by typing wrong passwords.

**Proposal (no SQL, in-memory like today):**
| Key | Limit | Purpose |
|---|---|---|
| `login:pair:<username>:<ip>` | 5 per 10 min | the normal brute-force brake for one attacker on one account |
| `login:ip:<ip>` | 20 per 10 min | one address spraying many usernames |
| `login:user:<username>` | 50 per hour, then a 2 s delay per attempt (not a block) | a distributed attack on one account slows down, but the real user can still sign in |

- A successful login clears the pair bucket.
- Messages stay generic ("invalid username or password").
- **Tests:** an attacker at address A cannot lock out the user at address B; A is blocked after 5; spraying from A
  is blocked after 20; the user-wide delay applies after 50.
- **Question for the owner:** is the 2 s delay acceptable, or a hard block for 15 minutes after 50?
