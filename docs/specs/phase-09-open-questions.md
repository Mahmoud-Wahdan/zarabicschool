# Phase 9 — Open Questions and SQL Waiting for Review

> Everything here waits for the owner. Decisions live in `phase-09-decisions.md` (referenced by ID); slices in `phase-09-plan.md`. **No migration is applied without the owner's explicit OK.** Each SQL becomes ONE new migration file (no BOM), applied by the owner. Rows marked **FINANCIAL/ATTENDANCE** touch money or attendance tables and need that explicit OK before any code that depends on them.

## Open questions

| ID | Question | Blocks | Proposal |
|---|---|---|---|
| OQ-1 | **ANSWERED → D36; S-1 SQL APPROVED → D37.** **Manual attendance resolution (D2):** (a) does a manual ATTENDED / STUDENT_ABSENT deduct the student's credit exactly as an approved report would (consume the reservation + `SESSION_DEDUCTION`)? (b) if the teacher submits a report AFTER a manual resolution, is it still accepted (it is the teacher's only pay source), and if its outcome differs, does the resolution stand + Admin flag? (c) are the 7 days counted from the scheduled end? | S-01 | (a) yes, the student side mirrors the report rule; no payroll entry. (b) accepted; approval pays the teacher and never deducts twice (reservation already CONSUMED); a different outcome raises an Admin flag and the resolution stands until the Admin corrects it with an adjustment. (c) yes, from `scheduled_end`. |
| OQ-2 | **ANSWERED → D38.** **Pending teacher (D9):** may a PENDING teacher log in? | S-02 | No. The user row is created inactive (`is_active=false`) and no credentials message is sent; approval activates the user, sets the rate and sends the credentials. Smallest model: `teachers.approval_status` (S-2). |
| OQ-3 | **ANSWERED → D39.** **Time zone (D3):** when the device zone differs from the stored zone, update silently only while the stored value was never chosen by a person (`timezone_source` DEFAULT/DEVICE); never overwrite a USER/ADMIN choice? | S-03 | Yes (S-3 adds the marker). |
| OQ-4 | **ANSWERED → D28.** **Join-window setting (D4):** allowed range for the Admin setting? | S-04 | 5–120 minutes, default 30; stored as the `academy_settings` key `join_window_minutes` (no schema change). |
| OQ-5 | **ANSWERED → D31.** **Daily schedule Arabic wording (D5)**, to approve or edit | S-08 | `صباح الخير يا {name}،` / `جدولك اليوم {weekday} {date}:` / `{n}. {student} - {minutes} دقيقة الساعة {time}` (group: `{n}. مجموعة ({count} طلاب) - {minutes} دقيقة الساعة {time}`) / `حصص التعويض:` (same line format) / `نتمنى لك يومًا مباركًا.` / `{academyName}` |
| OQ-6 | **ANSWERED → D29.** **Supervisor finance visibility (D11):** "remaining sessions" = credit left in the ACTIVE package(s) minus RESERVED; "paid/unpaid" = latest invoice status (PAID / PENDING / FAILED / CANCELLED, no amounts)? | S-09 | Yes. A separate Supervisor-safe read model; `canActOnStudentFinance` stays strict (the Supervisor still cannot ACT on finance). |
| OQ-7 | **ANSWERED → D30.** **Teacher calendar (D13):** show student names on the teacher's calendar? | S-10 | Yes: the teacher already sees roster names on the dashboard and report form; a group session shows "Group (n)" with names when expanded. |
| OQ-8 | **ANSWERED → D40.** **Overtime reconciliation (D14):** existing approved-overtime entries are `ADMIN_ADJUSTMENT` rows with `report_id` set (one per report). The ledger is append-only, so they cannot be back-filled. | S-12 | Treat `report_id IS NOT NULL` as category OVERTIME in queries; new manual entries carry an explicit category (S-5). |
| OQ-9 | **DONE → D35 (docs only).** **Trial clean-up (D15):** mark CONTEXT line 338 ("Free trial session … CONFIRMED direction") SUPERSEDED by D15, keep "no trial sessions" on lines 186/340, and strike phase-09 9.3 "account type", Q15 and S15 (history kept, struck through)? | docs only | Yes, on the owner's OK. |
| OQ-10 | **ANSWERED → D33 (keep the 32-bit cap).** **M-5:** the payroll amount cap is the 32-bit max (2,147,483,647 minor) while the sanity cap elsewhere is 100,000,000. Align payroll on 100,000,000? | — | Yes (validation only, no schema change). |
| OQ-11 | **ANSWERED → D41 (SQL when S-07 starts).** **M-6:** complaints keep no roster snapshot, so a later roster change (D18) changes who "another participant" can mean. Store the roster ids at complaint time? | S-07 | Yes; needs a column on `complaints` (not financial), SQL shown when S-07 starts. |
| OQ-12 | **ANSWERED → D42.** **Refund amount (D19):** the Admin enters the number of sessions to refund; amount = sessions × (invoice `amount_minor` / `sessions_purchased`), rounded down to the minor unit; limited by the package's unreserved remaining credit and by (amount paid − refunds so far). Confirm, or does the Admin type a free amount? | S-13 | Sessions-based (keeps the balance ≥ 0 by construction). |
| OQ-13 | **ANSWERED → D43.** **Webhook void/refund (D19):** a provider-side refund/void seen in the webhook records the event + an Admin flag only; the Admin then reconciles credit manually (no automatic ledger reversal). Confirm. | S-13 | Yes. |
| OQ-14 | **Assignments problems** (carried from phase-09 "Known issue" / Q2): the owner's list of student↔teacher↔subject problems. | S0 | — |
| OQ-16 | **ANSWERED → D32.** **M-2 teacher host link:** the spec stores an OPTIONAL host link (`zoom_host_url`) with a `?host=1` join variant for the assigned teacher/Admin/Supervisor, but no rule says the teacher's links (dashboard button, T+5 WhatsApp reminder) must use it; CONTEXT §84 lists "how the teacher starts a meeting" as an open assumption. Should the teacher's links point to `?host=1` when a host link is stored (plain join otherwise)? | S-00(i) | Yes — `?host=1` only when `zoom_host_url` is stored, so a session without one never answers NO_HOST_LINK. |
| OQ-17 | **CLOSED → D50.** **Close a session without a report (from OQ-1d):** if a teacher never reports (e.g. he left), how does the Admin close the session? | S-01 follow-up | no manual closing; derived state (D50) |
| OQ-15 | **DROPPED → D34.** **Commit-message trailers:** commits fdc7e16, be2862c, c9a19af, 38f0468 carry the trailers in the subject line. Fixing them needs a soft reset to 95be946 and re-commit (local history rewrite, nothing pushed). OK, or leave as is? | — | Leave as is unless the owner wants it; new commits use the correct format. |

## SQL waiting for review (NOT applied)

### S-1 — D2 manual attendance resolution — **APPROVED (D37), migration file `20261027120000_attendance_resolutions` created, owner applies it.** Extra CHECK added: `CHECK ("outcome" <> 'STUDENT_ABSENT' OR "subscription_ledger_id" IS NULL)`.
```sql
CREATE TABLE "attendance_resolutions" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "outcome" VARCHAR(20) NOT NULL,
  "reason" TEXT NOT NULL,
  "resolved_by" UUID NOT NULL,
  "resolved_by_role" VARCHAR(16) NOT NULL,
  "subscription_ledger_id" UUID,            -- the deduction it wrote, if any (OQ-1a)
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_resolutions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_resolutions_outcome_check" CHECK ("outcome" IN ('ATTENDED', 'STUDENT_ABSENT')),
  CONSTRAINT "attendance_resolutions_role_check" CHECK ("resolved_by_role" IN ('ADMIN', 'SUPERVISOR')),
  CONSTRAINT "attendance_resolutions_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 1000)
);
-- One resolution per roster entry; a correction is a new subscription_ledger ADMIN_ADJUSTMENT, never an edit.
CREATE UNIQUE INDEX "attendance_resolutions_session_student_key" ON "attendance_resolutions"("session_id", "student_id");
CREATE INDEX "attendance_resolutions_academy_created_idx" ON "attendance_resolutions"("academy_id", "created_at" DESC);
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_ledger_fkey" FOREIGN KEY ("subscription_ledger_id") REFERENCES "subscription_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Append-only audit, same trigger as the ledgers.
CREATE TRIGGER attendance_resolutions_append_only BEFORE UPDATE OR DELETE ON "attendance_resolutions"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
```
Write path (one transaction): lock the session row `FOR UPDATE`; check ended + roster + no SUBMITTED/APPROVED report + window by role; insert the resolution; update `session_students.attendance_status`; per OQ-1a consume the reservation + write the deduction; enqueue the Admin notice. No `payroll_ledger` write.

### S-2 — D9 teacher approval status (teachers table, not financial)
```sql
ALTER TABLE "teachers" ADD COLUMN "approval_status" VARCHAR(16) NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_approval_status_check" CHECK ("approval_status" IN ('PENDING', 'APPROVED'));
ALTER TABLE "teachers" ADD COLUMN "approved_by" UUID;
ALTER TABLE "teachers" ADD COLUMN "approved_at" TIMESTAMPTZ(6);
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Existing teachers stay APPROVED (default), so nothing changes for them.
```

### S-3 — D3 time-zone source marker (users table, not financial)
```sql
ALTER TABLE "users" ADD COLUMN "timezone_source" VARCHAR(8) NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE "users" ADD CONSTRAINT "users_timezone_source_check" CHECK ("timezone_source" IN ('DEFAULT', 'DEVICE', 'USER', 'ADMIN'));
```

### S-4 — D12 per-user read state (new table, not financial)
```sql
CREATE TABLE "notification_reads" (
  "user_id" UUID NOT NULL,
  "item_key" VARCHAR(200) NOT NULL,          -- e.g. "SESSION_REQUEST:<uuid>", ids only
  "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("user_id", "item_key")
);
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### S-5 — D14 adjustment category — **FINANCIAL (payroll_ledger), owner OK required**
```sql
ALTER TABLE "payroll_ledger" ADD COLUMN "adjustment_category" VARCHAR(20);
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_adjustment_category_check" CHECK (
  "adjustment_category" IS NULL
  OR ("entry_type" = 'ADMIN_ADJUSTMENT' AND "adjustment_category" IN ('BONUS', 'FINE', 'OVERTIME', 'OTHER'))
);
-- Existing rows stay NULL (append-only; overtime rows are recognized by report_id, OQ-8).
-- New Admin entries: the API requires a category + a reason; FINE amount < 0, BONUS/OVERTIME > 0, OTHER either sign.
```

### S-6 — D6 + D19 payment audit event types + refunds — **FINANCIAL (payment_audit, invoices), owner OK required**
```sql
ALTER TABLE "payment_audit" DROP CONSTRAINT "payment_audit_event_type_check";
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_event_type_check" CHECK (
  "event_type" IN ('CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REJECTED', 'REFUNDED',
                   'LINK_SENT', 'REFUND_REQUESTED', 'REFUND_FAILED', 'VOIDED', 'PROVIDER_REFUND_SEEN')
);

CREATE TABLE "invoice_refunds" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "sessions_refunded" INTEGER NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "provider_refund_id" VARCHAR(64),
  "idempotency_key" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "invoice_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_refunds_positive_check" CHECK ("sessions_refunded" > 0 AND "amount_minor" > 0),
  CONSTRAINT "invoice_refunds_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "invoice_refunds_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 1000)
);
CREATE UNIQUE INDEX "invoice_refunds_idempotency_key_key" ON "invoice_refunds"("idempotency_key");
CREATE INDEX "invoice_refunds_invoice_idx" ON "invoice_refunds"("invoice_id");
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_refunds" ADD CONSTRAINT "invoice_refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Status moves PENDING → SUCCEEDED/FAILED once (guarded in code under FOR UPDATE on the invoice);
-- the credit removal is a subscription_ledger REFUND row (existing type, negative sessions_delta), written only on SUCCEEDED.
-- Cumulative check (code, same transaction): SUM(amount_minor WHERE status <> 'FAILED') + new ≤ invoices.amount_minor.
```
Design note: a refund calls the provider (Paymob refund API), so the row is written PENDING before the call and finished after it. A crash leaves it PENDING for the Admin to see, and the idempotency key prevents a silent double refund. Card-not-present auto-renewal via Paymob subscriptions untouched (D19, D44).

### S-1b — manual deduction without a report — **APPROVED (D46); migration file `20261027130000_subscription_ledger_manual_deduction` created, the owner applies it.**
```sql
ALTER TABLE "subscription_ledger" DROP CONSTRAINT "subscription_ledger_session_deduction_check";
ALTER TABLE "subscription_ledger" ADD CONSTRAINT "subscription_ledger_session_deduction_check" CHECK (
  "entry_type" <> 'SESSION_DEDUCTION' OR ("sessions_delta" = -1 AND "session_id" IS NOT NULL)
);
```

### S-1c — every SESSION_DEDUCTION needs a source — **APPROVED (D49); migration file `20261027140000_subscription_ledger_deduction_source` created, the owner applies it.**
Deferred constraint trigger `subscription_ledger_deduction_source` (function `require_deduction_source()`): a deduction without `report_id` must be referenced by an attendance resolution at COMMIT. CHECK, unique deduction index and append-only trigger unchanged.

## Automatic renewal (S-RENEW, 2026-10-28)

| # | Question | Slice | Answer |
|---|---|---|---|
| OQ-R1 | **CLOSED → D60.** Sign-up state before the first payment is verified. | S-RENEW | `INCOMPLETE` status + one live renewal per student |
| OQ-R2 | **ANSWERED → D80** (no new bookings during grace; booking works again after the payment succeeds). **During the 3-day grace (D58), may the student book new sessions, and from which credits?** The old month's unused sessions already expire at period end (no rollover), so today a student without a paid renewal has no credits during grace. Nothing was changed. | S-RENEW | — (owner to decide) |
| OQ-R3 | **Paymob `retrial_days`:** its meaning is undocumented (one retry after N days, or a retry each day?). Plans are created without it (Paymob's default). Confirm with Paymob (ticket EG-2026-94026) and decide a value. | S-RENEW | — (owner / Paymob) |
| OQ-R4 | **Wording of the sign-up receipt and the cancel option (D57):** the current Arabic/English texts are drafts (terms, same day each month, last day in short months, no refund of a paid month, cancel from the Payments page). | S-RENEW | — (owner wording) |
| OQ-R5 | **Paymob `created_at` time zone:** read as Africa/Cairo wall time (the published renewal sample charged at 00:01 on the billing date). Confirm in the first test-mode renewal. | S-RENEW | — (test-mode run) |
| OQ-S13-1 | **ANSWERED → D81** (rolling 24 h; the calendar-day build is fixed). **"Max 1 payment link per day" (D6): which day?** Built as a calendar day in the payer's zone (consistent with D20). Confirm or choose the academy zone / a rolling 24 h. | S-13 | — (owner to confirm) |
