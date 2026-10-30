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
   - Without one (the crash case, **D93**): the outcome is unknown, never "failed", and the refund is
     **never re-sent automatically**, because Paymob documents no idempotency key for refunds and a resend
     could refund twice. A signed Paymob refund callback (it carries `parent_transaction` and the parent gets
     `is_refunded: true`) is used only as a trigger. The worker then retrieves the parent transaction from
     Paymob (`refunded_amount_cents`) with back-off and settles the row only when the amount matches exactly.
     After 24 h without an answer the row goes to the Admin's **"unknown refunds"** list, where the Admin
     records what the Paymob dashboard shows (succeeded / failed, reason required, audited row; the same
     rules 2/3 apply).
5. **Admin list:** a "Pending refunds" card on `/admin/invoices`, Admin only. It shows invoice, sessions,
   amount, age, last check and Paymob refund id, plus a link to the invoice.

**SQL S-10 (proposed; revised 2026-10-30: explicit transaction):**
```sql
BEGIN;
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
CREATE INDEX "invoice_refunds_pending_next_check_idx" ON "invoice_refunds"("next_check_at" ASC NULLS FIRST) WHERE "status" = 'PENDING';
-- D93: the Admin records the outcome of an "unknown" refund (seen in the Paymob dashboard).
ALTER TABLE "invoice_refunds" ADD COLUMN "resolved_by" UUID;
ALTER TABLE "invoice_refunds" ADD COLUMN "resolution_note" TEXT;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_resolved_by_fkey"
  FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_manual_resolution_check" CHECK (
  ("resolved_by" IS NULL AND "resolution_note" IS NULL)
  OR ("resolved_by" IS NOT NULL AND "status" <> 'PENDING' AND char_length(btrim("resolution_note")) BETWEEN 5 AND 500)
);
COMMIT;
```

**Why the money is safe (reasoning):**
- **Append-only:** the hold is an INSERT, and so is the restore after a refusal (a new `ADMIN_ADJUSTMENT +n`).
  The existing trigger on `subscription_ledger` refuses UPDATE and DELETE. `invoice_refunds` is a normal
  table: only its status, completion time and resolution fields change, exactly once, under the invoice lock
  (`WHERE status = 'PENDING'` conditional update).
- **Unique constraints:**
  - one hold per refund (`…one_refund_hold_key`) and one restore per refund (`…one_refund_reversal_key`), so a
    retried worker or a double Admin click cannot hold or restore twice;
  - `invoice_refunds.idempotency_key` stays unique;
  - the CHECK keeps the link only on a negative REFUND or a positive restore.
- **Rollback:**
  - The PENDING row, the hold and the `REFUND_REQUESTED` audit row commit together, or not at all.
  - Paymob is called **only after** that commit. A crash before the call leaves PENDING + hold with no money
    sent: the worker finds no refund at Paymob, and after 24 h the Admin resolves it.
  - Finishing (SUCCEEDED, or FAILED + restore + audit) is a second transaction; it is all-or-nothing too.
- **Concurrency with booking:**
  - Booking runs `runSerializable`. The refund request will run in the same `runSerializable` helper (retry
    on a serialization failure), so a booking and a refund that read the same balance cannot both commit.
  - Today the refund runs at READ COMMITTED; this closes that gap.
- **Idempotency:**
  - The same `Idempotency-Key` returns the first refund row (200) before anything is written.
  - A concurrent duplicate loses on the unique key and re-reads the winner.
  - Paymob is never called twice for one refund row: the call is made once, right after the row is created,
    and the worker only reads Paymob.

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

## Owner questions on B1 / B4 (2026-10-30) — answers. Still NOT approved; nothing applied.

**1. Is each migration atomic, and applied via DIRECT_URL?**
- **DIRECT_URL: yes.** `webapp/prisma.config.ts` gives Prisma Migrate `datasource.url = DIRECT_URL` (the direct
  connection, not the pooler). The app itself uses `DATABASE_URL`.
- **Atomic: NOT by default.** Tested on 2026-10-30 against a throwaway local database (dropped afterwards):
  - A plain `migration.sql` whose 2nd statement fails: `prisma migrate deploy` stops with P3018, but the 1st
    statement (`CREATE TABLE`) **stayed**. The migration row is marked unfinished. That is a partial state.
  - The same file wrapped in `BEGIN; … COMMIT;`: the failure left **nothing** behind (the table did not exist).
  - The wrapped file without the error applied fully and was recorded as finished.
- **So every new migration file (S-10, S-11, S-12) starts with `BEGIN;` and ends with `COMMIT;`.** None of them
  uses `ALTER TYPE … ADD VALUE` (which cannot share a transaction with statements that use the new value), and
  none uses `CREATE INDEX CONCURRENTLY` (not allowed in a transaction). The tables are small, so the plain index
  builds take a short lock.
- If one still fails: nothing was written; fix the file, run `npx prisma migrate resolve --rolled-back <name>`,
  then deploy again.

**2. schema.prisma** — changed in the SAME commit as each migration, never before. A model field without its
column makes Prisma select a column that does not exist, so every query on that table would fail. The exact text:
```prisma
// SubscriptionLedger (S-10)
invoiceRefundId String?        @map("invoice_refund_id") @db.Uuid
invoiceRefund   InvoiceRefund? @relation(fields: [invoiceRefundId], references: [id], onDelete: Restrict)
// InvoiceRefund (S-10)
nextCheckAt    DateTime?           @map("next_check_at") @db.Timestamptz(6)
checkCount     Int                 @default(0) @map("check_count")
resolvedBy     String?             @map("resolved_by") @db.Uuid
resolutionNote String?             @map("resolution_note")
resolver       User?               @relation("InvoiceRefundResolver", fields: [resolvedBy], references: [id], onDelete: Restrict)
ledgerEntries  SubscriptionLedger[]
// + on User: refundsResolved InvoiceRefund[] @relation("InvoiceRefundResolver")
// Subscription (S-11)
expiryNextCheckAt DateTime? @map("expiry_next_check_at") @db.Timestamptz(6)
// BillingSubscription (S-11)
nextCheckAt DateTime? @map("next_check_at") @db.Timestamptz(6)
```
Partial unique indexes, partial indexes with `NULLS FIRST` and CHECKs cannot be written in schema.prisma; they
live in the SQL only (as with the existing ones), and `db:verify` will list the new unique indexes.

**3. B1: a pre-existing PENDING refund, and the balance is already below n.** Recommended: **flag the Admin, never
drive the balance negative.**
- When the worker first sees a PENDING refund without a hold, it locks the package (`FOR UPDATE`, the same order as
  the request) and computes the free balance exactly as the request does today:
  `SUM(sessions_delta) − RESERVED reservations − other PENDING refunds`.
- If free ≥ n: it writes the hold (`REFUND −n`, linked) in that transaction.
- If free < n (sessions were used or booked since, or the package expired): **no hold, no ledger row.** The
  refund stays PENDING, is flagged once to the Admin (`REFUND_HOLD_SHORT`, dedup on the refund id; ids only, no
  amounts in WhatsApp) and appears in the Admin "unknown / pending refunds" list marked "sessions already used".
  The Admin decides from the Paymob dashboard, with a written reason. Money is never moved by the worker.
- Pre-flight before applying (read-only): the count of PENDING refunds, and how many would be short. Today 0 in
  the test data.

**4. B4 details.**
- **NULLS FIRST:** yes, explicit in both partial indexes (above) and in the queries (Prisma
  `orderBy: { expiryNextCheckAt: { sort: "asc", nulls: "first" } }`). Postgres sorts ASC with NULLS LAST by
  default, so without it the never-checked rows would come last and the index would not match the ORDER BY.
- **INCOMPLETE exists:** `ALTER TYPE "BillingSubscriptionStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE'` in migration
  `20261028090000_billing_subscription_incomplete` (applied), and `schema.prisma` line 1118. Because it was added
  in an earlier, already-committed migration, S-11 may use it inside its transaction.
- **One worker or SKIP LOCKED — recommended: one worker, enforced by the database.**
  - The runbook runs ONE worker (`WORKER_MODE=separate` + one `npm run worker`).
  - Add a guard with no SQL migration: each tick first takes `pg_try_advisory_lock(<fixed worker key>)` on its
    own connection. If another worker holds it, the tick is skipped and logged once. So a second worker started
    by mistake does nothing.
  - Not `FOR UPDATE SKIP LOCKED`: claiming rows that way keeps a transaction open during the Paymob call
    (seconds). It is the right tool for many workers, which the MVP does not need.
  - The money is already safe even with two workers (conditional updates, unique indexes, serializable expiry);
    the lock prevents duplicate Paymob calls and duplicate notices.

**5. B1 Paymob retrieve call.** Agreed: the retrieve-transaction call stays **disabled** (code path behind a flag
that is off, with a test that no HTTP call is made) until the test-mode run after "go". Until then the worker
only schedules and flags; the Admin "unknown refunds" list is the MVP fallback, where the Admin records the result
seen in the Paymob dashboard (reason required, audited).

## B2 — Reschedule checks the teacher's time and refuses after a report

**Rule:**
- `PATCH /api/sessions/[id]` with a time change runs in one transaction:
  1. Lock the session row `FOR UPDATE`.
  2. Re-read it. Refuse with 409 `SESSION_HAS_REPORTS` if any report of the session is SUBMITTED or APPROVED.
  3. Run `assertTeacherFree(tx, academy, teacher, newStart, newEnd, { excludeSessionId })`, then write.
- `assertTeacherFree` gains an optional `excludeSessionId`.
- The approval path's `FOR SHARE` lock conflicts with this `FOR UPDATE`, so an approval and a reschedule are serialized.
- Link-only and cancellation edits are unchanged.
- **Owner, 2026-10-30 (D88):** a REJECTED report also blocks a time change.

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

**SQL S-11 (proposed; revised 2026-10-30: explicit transaction, NULLS FIRST in the indexes):**
```sql
BEGIN;
ALTER TABLE "subscriptions" ADD COLUMN "expiry_next_check_at" TIMESTAMPTZ(6);
CREATE INDEX "subscriptions_expiry_due_idx"
  ON "subscriptions"("expiry_next_check_at" ASC NULLS FIRST, "period_ends_at" ASC)
  WHERE "status" = 'ACTIVE' AND "package_type" IN ('MONTHLY_PLAN', 'ANNUAL_PLAN');
ALTER TABLE "billing_subscriptions" ADD COLUMN "next_check_at" TIMESTAMPTZ(6);
CREATE INDEX "billing_subscriptions_next_check_idx"
  ON "billing_subscriptions"("next_check_at" ASC NULLS FIRST)
  WHERE "status" IN ('INCOMPLETE', 'ACTIVE', 'PAST_DUE');
COMMIT;
```
No ledger table changes. Existing rows start with NULL, so they are checked on the first tick.

**Why it is safe (reasoning):**
- **Append-only:** no ledger row is touched. Only the two new scheduling columns on `subscriptions` and
  `billing_subscriptions` change; they are mutable tables, and those columns carry no money.
- **No starvation:** a row that cannot progress (live reservation, past-due renewal) moves its `*_next_check_at`
  into the future, so the 100-row batch always reaches newer rows. Batches are ordered by that column (NULL first).
- **Rollback / idempotency:**
  - The expiry pass stays ONE serializable transaction per package; the `EXPIRY` amount is recomputed inside
    it, so a repeated or overlapping pass writes nothing twice.
  - Setting the next-check time is part of the same transaction (expiry), or a single conditional UPDATE
    (renewal), so a crash only means the row is checked again.
- **D84:** the reservation is never changed by the worker; it waits for the report or a manual resolution.

**Tests (WK-01..05):**
- 101 packages with live reservations plus one newer drained package: the newer one expires in the first tick.
- The reservation row is byte-for-byte unchanged.
- 101 stale PAST_DUE subscriptions: a newer ACTIVE one is still swept.
- After a restart (a fresh module), the throttle holds because it is read from the DB.

## D80 / D89 / D96 — New bookings blocked only AFTER the renewal grace (no SQL)

> **Corrected by the owner on 2026-10-30 (D96).** The first version refused bookings as soon as the renewal
> was PAST_DUE; that was wrong. CONTEXT §7 and §20.6: the grace comes first, the block only after it.

**Rule:**
- **During the grace** (PAST_DUE and `now < grace_ends_at`): every booking path works.
- **After the grace** (PAST_DUE and `now >= grace_ends_at`, or no grace end stored): every new booking path refuses
  with 409 `RENEWAL_PAST_DUE`: single session, series creation, enrollment, replacement and roster add,
  pay-per-session included (D89).
- The worker's weekly series extension then pauses the series, the same way as a lack of credit (an Admin
  `SERIES_PAUSED` notice). During the grace it does not pause.
- Sessions already booked, reports and teacher pay are never affected. A verified renewal (status ACTIVE) unblocks.
- **Where "past due since" is stored:** nothing new is needed. `billing_subscriptions.grace_ends_at` already exists
  and is written when the worker marks the row PAST_DUE (period end + grace days).
- **Grace days:** the Admin setting `billing.renewal_grace_days` (1–14, default 3), read at that moment. A change
  applies to graces that start later.
- One check in `reserveCredit` and `resolveParticipants` (`studentsPastRenewalGrace`), so every path is covered.

**Tests:**
- GR-01: during the grace, single, series, enrollment and the worker reservation all book.
- GR-02: after the grace, each path gets 409 and the worker reservation refuses.
- GR-03: existing bookings stay; ACTIVE unblocks. GR-04: no renewal problem → books.
- GR-05: boundary: 1 ms before `grace_ends_at` books; at the exact end and after, blocked.
- GR-06: PAST_DUE with no stored end → blocked.
- RN-05b: a setting of 5 days gives `grace_ends_at` = period end + 5 days. GS-01..04: the setting route.

## Low — login lockout (owner, 2026-10-30, D90)

| Key | Limit (failed attempts only) | Purpose |
|---|---|---|
| `login:pair:<username>:<address>` | 3, then blocked for 15 min | the owner's rule: 3 wrong passwords block that sign-in |
| `login:ip:<address>` | 20 per 10 min | one address spraying many usernames |
| `login:user:<username>` | 50 per hour from all addresses, then blocked for 15 min | a distributed attack on one account |

- A successful sign-in clears its pair counter.
- An attacker at another address cannot lock the real user out with 3 tries.
- Messages stay generic.

**Tests:**
- 3 failures, then the 4th attempt is refused even with the right password, until 15 min pass.
- Another address still signs in.
- 20 failures from one address over many usernames get it blocked.
- 50 failures from many addresses block the username.
- Success clears the pair counter.
