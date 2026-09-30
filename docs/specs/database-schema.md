# Zarabicschool — Database Schema

> **Status: Architecture Aligned — Updated with confirmed 2026-09-29 business rules.**
>
> **Conventions:**
> - All IDs are `UUID` (generated via `gen_random_uuid()`).
> - All tenant-owned tables have an `academy_id` FK (single UUID, seeded once — not an env var).
> - Money is stored as **integer minor units** (cents, piasters, etc.) — never floats.
> - Currency is stored as **ISO 4217 code** (`VARCHAR(3)`) — multi-currency supported, balances tracked per currency.
> - Timestamps are `TIMESTAMPTZ` (timezone-aware).
> - Dual-ledger financial design: `SubscriptionLedger` counts sessions and `PayrollLedger` stores teacher compensation.
>
> Last updated: 2026-09-28

---

## 1. Academies

Single row for v1. Provides an anchor for future SaaS tenancy without rewriting schemas.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Seeded once at init. Not an env var. |
| `name` | VARCHAR | NOT NULL | "Zarabicschool" |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---


## 2. Users

Unified authentication table. Role-specific details live in profile tables.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `email` | VARCHAR | UNIQUE, NOT NULL | Created by admin / provisioned |
| `password_hash` | VARCHAR | NOT NULL | Stored via bcrypt |
| `display_name` | VARCHAR | NOT NULL | |
| `phone` | VARCHAR | | For WhatsApp notifications |
| `role` | ENUM | NOT NULL | `ADMIN`, `TEACHER`, `STUDENT`, `GUARDIAN` |
| `timezone` | VARCHAR | NOT NULL, DEFAULT 'Africa/Cairo' | IANA timezone identifier for all user schedule localization |
| `is_active` | BOOLEAN | DEFAULT true | Admin can deactivate; checked on every authenticated request |
| `must_change_password` | BOOLEAN | DEFAULT true | Forced password reset on first login |
| `password_changed_at` | TIMESTAMPTZ | nullable | Timestamp when user last changed password |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 3. Guardians

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `user_id` | UUID | FK → Users, UNIQUE, NOT NULL | 1:1 with Users |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `relationship` | ENUM | NOT NULL | `FATHER`, `MOTHER` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 4. Students

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `user_id` | UUID | FK → Users, UNIQUE, NOT NULL | 1:1 with Users |
| `guardian_id` | UUID | FK → Guardians, nullable | Nullable for adult students studying independently; required for minors |
| `is_adult` | BOOLEAN | DEFAULT false | True if student studies without a guardian |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `enrollment_date` | DATE | | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 5. Teachers

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `user_id` | UUID | FK → Users, UNIQUE, NOT NULL | 1:1 with Users |
| `academy_id` | UUID | FK → Academies, NOT NULL | || `hourly_rate_minor` | INTEGER | NOT NULL, DEFAULT 0 | Hourly rate agreed with academy (e.g. in piasters/cents) |
| `hourly_rate_currency` | VARCHAR(3) | NOT NULL, DEFAULT 'EGP' | ISO 4217 code (`EGP`, `USD`) |
| `late_reports_count` | INTEGER | DEFAULT 0 | Count of red marks for overdue session reports |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 6. Subjects

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `name` | VARCHAR | NOT NULL | e.g. "Quran Recitation", "Arabic Grammar" |
| `description` | TEXT | | |
| `is_active` | BOOLEAN | DEFAULT true | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 7. TeacherSubjects

Junction table: many-to-many relationship between Teachers and Subjects.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `subject_id` | UUID | FK → Subjects, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `assigned_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| | | UNIQUE(teacher_id, subject_id) | |

---

## 8. Enrollments

Maps confirmed student–teacher–subject educational relationships.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `subject_id` | UUID | FK → Subjects, NOT NULL | |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `CONFIRMED`, `REJECTED`, `ENDED` |
| `confirmed_by` | UUID | FK → Users, nullable | Admin who confirmed the pairing |
| `confirmed_at` | TIMESTAMPTZ | nullable | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| | | UNIQUE(student_id, teacher_id, subject_id) | Prevent duplicate active pairings |

---

### 9. Applications

Inbound registration leads from public landing page application forms across 3 distinct applicant roles (**Guardian**, **Student**, **Teacher**).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `applicant_type` | ENUM | NOT NULL | `GUARDIAN`, `STUDENT`, `TEACHER` |
| `full_name` | VARCHAR | NOT NULL | Name of the applicant |
| `email` | VARCHAR | NOT NULL | Email for account provisioning and outreach |
| `phone` | VARCHAR | NOT NULL | WhatsApp contact number for credential delivery |
| `preferred_timezone` | VARCHAR | | Timezone of applicant |
| `is_adult_student` | BOOLEAN | nullable | For student applicant: true if adult studying independently |
| `guardian_name` | VARCHAR | nullable | For minor student applicant: parent/guardian name |
| `guardian_phone` | VARCHAR | nullable | For minor student applicant: parent WhatsApp number |
| `expected_hourly_rate_minor` | INTEGER | nullable | For teacher applicant: expected rate per hour |
| `expected_rate_currency` | VARCHAR(3) | nullable | For teacher applicant: currency (`EGP`, `USD`) |
| `target_subjects` | TEXT[] | nullable | Subjects interested in learning / teaching |
| `notes` | TEXT | | Application message, qualifications, or student details |
| `payload` | JSONB | nullable | Role-specific details (e.g., child count/names for guardian, CV/experience for teacher) |
| `status` | ENUM | DEFAULT 'NEW' | `NEW`, `REVIEWED`, `APPROVED`, `REJECTED` |
| `reviewed_by` | UUID | FK → Users, nullable | Admin who reviewed/approved |
| `reviewed_at` | TIMESTAMPTZ | nullable | |
| `approved_user_id` | UUID | FK → Users, nullable | Link to user record created upon approval |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 10. Sessions

Represents scheduled live learning meetings.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `subject_id` | UUID | FK → Subjects, NOT NULL | |
| `session_type` | ENUM | NOT NULL | `PRIVATE` (1:1), `GROUP` (1:N) |
| `scheduled_start` | TIMESTAMPTZ | NOT NULL | |
| `scheduled_end` | TIMESTAMPTZ | NOT NULL | CHECK (scheduled_end > scheduled_start) |
| `duration_minutes` | INTEGER | NOT NULL | Calculated duration |
| `zoom_join_url` | TEXT | NOT NULL | Admin-pasted participant link; required before the session starts |
| `zoom_host_url` | TEXT | nullable | Optional host link if the teacher needs one; OPEN whether this is stored |
| `status` | ENUM | DEFAULT 'SCHEDULED' | `SCHEDULED`, `COMPLETED`, `MISSED`, `CANCELLED` |
| `is_recurring` | BOOLEAN | DEFAULT false | Part of weekly recurring schedule |
| `recurrence_rule` | VARCHAR | nullable | e.g. "WEEKLY:MON,THU:18:00" |
| `recurrence_group_id` | UUID | nullable | Links weekly recurring session series |
| `replacement_for_session_id` | UUID | FK → Sessions, nullable | Links replacement session to missed original |
| `cancellation_reason` | TEXT | nullable | Technical outage, absence notes, etc. |
| `created_by` | UUID | FK → Users, NOT NULL | Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

> **Security Note:** Zoom URLs are secrets. Never log them. They are readable only by Admin, the assigned teacher, and the session's students; guardian visibility is OPEN. The same link is copied to generated sessions in a recurrence group as a PROPOSAL, and remains editable per session.

> **Status transitions:** `SCHEDULED → COMPLETED` after the session and reports are handled; `SCHEDULED → MISSED` when the session did not take place; `SCHEDULED → CANCELLED` by Admin with a reason. Completed, missed, and cancelled sessions are terminal except for an audited Admin correction or a linked replacement session. `scheduled_end > scheduled_start` and `duration_minutes` must equal the interval; these prevent invalid payroll duration snapshots.

---

## 11. SessionStudents

Junction mapping students to sessions. Attendance is a report result, not a Zoom event result.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `attendance_status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `ATTENDED`, `ABSENT`, `NOT_HELD`; set only by report submission or audited Admin override |
| `overridden_by` | UUID | FK → Users, nullable | Admin who overrode the report result |
| `override_reason` | TEXT | nullable | Required for an Admin override |
| | | UNIQUE(session_id, student_id) | |

> **Constraint reason:** one row per student/session prevents duplicate assignment and gives the report a stable attendance target. A student absence does not create a deduction or credit; an attended report triggers settlement in Phase 6.

### Optional SessionJoinClicks (PROPOSAL / OPTIONAL)

If retained, the redirect behind the Zoom button writes `(session_id, user_id, clicked_at)`. It is soft evidence for Admin, never proof of attendance, and must not store or log the URL.

---

---

## 12. Subscriptions

Stores core configuration for student prepaid session packages. Remaining session balance is derived exclusively from `SubscriptionLedger`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `total_amount_minor` | INTEGER | NOT NULL | Package purchase price in minor units |
| `currency` | VARCHAR(3) | NOT NULL | ISO 4217 code (`USD`, `EGP`) |
| `sessions_purchased` | INTEGER | NOT NULL | Total sessions bought in this package |
| `status` | ENUM | DEFAULT 'ACTIVE' | `ACTIVE`, `EXHAUSTED`, `CANCELLED` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

> **Business Rule (Confirmed):** Packages have no time-based expiration date. The former per-session price field is intentionally absent because package consumption is one session per attended class, and teacher pay is hourly and independent.

---

## 13. SubscriptionLedger

Append-only ledger tracking all quota mutations to a student's subscription. Balance is computed from `SUM(sessions_delta)`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `subscription_id` | UUID | FK → Subscriptions, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `entry_type` | ENUM | NOT NULL | `INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND` |
| `sessions_delta` | INTEGER | NOT NULL | (+N for purchase, -1 for session deduction) |
| `amount_minor` | INTEGER | nullable | DECISION REQUIRED: remove it or retain as informational; recommend removing it because invoices are the money source of truth |
| `currency` | VARCHAR(3) | NOT NULL | Must match subscription currency |
| `session_id` | UUID | FK → Sessions, nullable | Linked session for deductions |
| `report_id` | UUID | FK → Reports, nullable | Required on `SESSION_DEDUCTION`; identifies the report that triggered the deduction |
| `description` | TEXT | nullable | Audit explanation |
| `created_by` | UUID | FK → Users, nullable | NULL = system-generated; NOT NULL = Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

### Double-Deduction Guard (Raw SQL Migration)
```sql
CREATE UNIQUE INDEX idx_subscription_ledger_unique_session_deduction
ON subscription_ledger (session_id, subscription_id)
WHERE entry_type = 'SESSION_DEDUCTION';
```

---

## 14. Invoices

Manual billing records generated for student subscription packages.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `subscription_id` | UUID | FK → Subscriptions, nullable | Linked package created upon confirmation |
| `amount_minor` | INTEGER | NOT NULL | Total payable |
| `currency` | VARCHAR(3) | NOT NULL | ISO 4217 code |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `PAID`, `CANCELLED` |
| `confirmed_by` | UUID | FK → Users, nullable | Admin who verified payment |
| `confirmed_at` | TIMESTAMPTZ | nullable | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 15. PaymentProofs

Stores references to payment receipts uploaded to private Supabase Storage.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `invoice_id` | UUID | FK → Invoices, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `file_path` | VARCHAR | NOT NULL | Private bucket path in Supabase Storage |
| `proof_type` | ENUM | NOT NULL | `RECEIPT_IMAGE`, `TRANSACTION_REFERENCE` |
| `uploaded_by` | UUID | FK → Users, NOT NULL | Guardian or Student |
| `uploaded_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 16. PayrollLedger

**Append-only teacher financial ledger.** Tracks all earnings and manual adjustments per currency.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `session_id` | UUID | FK → Sessions, nullable | Session that generated payment |
| `report_id` | UUID | FK → Reports, nullable | Report that triggered a session credit |
| `student_id` | UUID | FK → Students, nullable | Needed for adjustments only; not needed on `SESSION_CREDIT` |
| `amount_minor` | INTEGER | NOT NULL | Minor units (+ credit, - debit/disbursement) |
| `currency` | VARCHAR(3) | NOT NULL | ISO 4217 code |
| `minutes_credited` | INTEGER | nullable | Scheduled duration snapshot; not observed Zoom time |
| `hourly_rate_snapshot_minor` | INTEGER | nullable | Rate used for a session credit; preserves history after a rate change |
| `entry_type` | ENUM | NOT NULL | `SESSION_CREDIT`, `ADMIN_ADJUSTMENT`, `DISBURSEMENT` |
| `source` | ENUM | NOT NULL | `REPORT`, `ADMIN` |
| `description` | TEXT | nullable | Mandatory for admin adjustments (e.g., approved overtime) |
| `created_by` | UUID | FK → Users, nullable | NULL = system-generated; NOT NULL = Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

### Double-Credit Guard (Raw SQL Migration)
```sql
CREATE UNIQUE INDEX idx_payroll_ledger_unique_session_credit
ON payroll_ledger (session_id)
WHERE entry_type = 'SESSION_CREDIT';
```

---

---

## 17. Reports

Per-student teacher reports. In a group session there is one report for each student.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | Linked session |
| `student_id` | UUID | FK → Students, NOT NULL | Student covered by this report |
| `author_id` | UUID | FK → Users, NOT NULL | Assigned teacher who submits it |
| `report_type` | ENUM | NOT NULL | `SESSION_COMPLETION_REPORT` |
| `attendance_outcome` | ENUM | NOT NULL | `ATTENDED`, `STUDENT_ABSENT`, plus OPEN outcomes |
| `class_remark` | ENUM | NOT NULL | Dropdown values OPEN |
| `summary` | TEXT | NOT NULL | Required lesson summary |
| `homework` | TEXT | NOT NULL | Required homework value; student visibility is OPEN |
| `notes` | TEXT | nullable | Optional notes |
| `extra_time_minutes` | INTEGER | DEFAULT 0 | Frozen after submission |
| `extra_time_status` | ENUM | DEFAULT 'NONE' | `NONE`, `PENDING`, `APPROVED`, `REJECTED` |
| `extra_time_reviewed_by` | UUID | FK → Users, nullable | Admin reviewer |
| `extra_time_reviewed_at` | TIMESTAMPTZ | nullable | Review timestamp |
| `submitted_at` | TIMESTAMPTZ | NOT NULL | Submission timestamp |
| `settled_at` | TIMESTAMPTZ | nullable | Set in the same transaction as settlement ledger rows; never cleared to retry |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

### Report Uniqueness Guard
```sql
CREATE UNIQUE INDEX idx_reports_unique_session_completion
ON reports (session_id, student_id)
WHERE report_type = 'SESSION_COMPLETION_REPORT';
```

`attendance_outcome` and `extra_time_minutes` are frozen after submission. Text fields remain editable under server-side authorization and audit rules. A settled report is a claim: corrections use `ADMIN_ADJUSTMENT` or refund entries, never clearing `settled_at`.

Teacher reports are visible to the guardian and Admin, not the student; whether the student sees homework is OPEN. Student evaluations are Admin-only.

## 18. ReportAttachments

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `report_id` | UUID | FK → Reports, NOT NULL | |
| `file_path` | VARCHAR | NOT NULL | Private Supabase Storage path; DB stores no file content |
| `mime_type` | VARCHAR | NOT NULL | Allowlist images and PDF is recommended; exact list OPEN |
| `size_bytes` | BIGINT | NOT NULL | Size cap is OPEN; recommend a small documented cap |
| `original_name` | VARCHAR | NOT NULL | Display name, never used as a storage path |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

Access uses short-lived signed URLs. Executables are prohibited.

---

## 19. TeacherFlags ("النقطة الحمراء")

Informational tracking of teacher compliance violations (e.g., overdue session completion reports).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | Session where violation occurred |
| `flag_type` | ENUM | NOT NULL | `LATE_REPORT` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| | | UNIQUE(session_id, flag_type) | One flag per session violation |

---

## 20. SessionRequests

MVP outage or absence request routing. The reason is handled between Admin and the teacher humanly; the system stores and routes the request only.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | Affected session (bound automatically from session button) |
| `requested_by` | UUID | FK → Users, NOT NULL | Student, teacher, or other permitted requester |
| `reason` | TEXT | NOT NULL | Human-readable request reason |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `APPROVED`, `REJECTED` |
| `reviewed_by` | UUID | FK → Users, nullable | Admin who reviewed |
| `reviewed_at` | TIMESTAMPTZ | nullable | |
| `replacement_session_id` | UUID | FK → Sessions, nullable | Linked replacement session if approved |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 21. Evaluations

Post-session structured rating forms filled by students about teachers (**Optional** for students).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `evaluator_id` | UUID | FK → Users, NOT NULL | Student |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | Teacher |
| `responses` | JSONB | NOT NULL | Structured responses |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| | | UNIQUE(session_id, evaluator_id) | One evaluation per student per session |

---

## 22. Complaints ("شكاوى واقتراحات")

General complaints or feedback submitted by users (students, guardians, teachers) via the dashboard button.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `user_id` | UUID | FK → Users, NOT NULL | Submitter (Student, Guardian, Teacher) |
| `title` | VARCHAR | NOT NULL | Complaint title / subject |
| `content` | TEXT | NOT NULL | Details of the complaint |
| `status` | ENUM | DEFAULT 'OPEN' | `OPEN`, `RESOLVED`, `CLOSED` |
| `admin_response` | TEXT | nullable | Admin resolution notes / feedback |
| `resolved_by` | UUID | FK → Users, nullable | Admin who handled the complaint |
| `resolved_at` | TIMESTAMPTZ | nullable | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 23. Announcements

Broadcast notices issued by Admin.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `created_by` | UUID | FK → Users, NOT NULL | Admin only |
| `title` | VARCHAR | NOT NULL | |
| `content` | TEXT | NOT NULL | |
| `target_audience` | ENUM | DEFAULT 'ALL' | `ALL`, `STUDENTS`, `TEACHERS`, `GUARDIANS` |
| `is_active` | BOOLEAN | DEFAULT true | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 24. NotificationLog

Auditing log for WhatsApp and SMS communications.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `recipient_id` | UUID | FK → Users, NOT NULL | |
| `session_id` | UUID | FK → Sessions, nullable | Linked session context |
| `channel` | ENUM | DEFAULT 'WHATSAPP' | `WHATSAPP`, `SMS` (SMS post-MVP) |
| `notification_type` | VARCHAR | NOT NULL | `SESSION_REMINDER`, `LATE_ARRIVAL`, `CREDENTIALS`, etc. |
| `idempotency_key` | VARCHAR | UNIQUE, NOT NULL | Deduplication key preventing duplicate sends |
| `content` | TEXT | NOT NULL | Template key plus redacted content/metadata; credentials store no password |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `SENT`, `FAILED` |
| `sent_at` | TIMESTAMPTZ | nullable | |
| `error` | TEXT | nullable | Provider error details |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 25. TeacherRates

**DECISION REQUIRED:** use an effective-dated table or a single field on `Teachers`. Recommend this table because every credit must preserve the rate used at settlement.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `hourly_rate_minor` | INTEGER | NOT NULL | Agreed hourly rate |
| `currency` | VARCHAR(3) | NOT NULL | One currency per teacher is OPEN |
| `effective_from` | TIMESTAMPTZ | NOT NULL | Rate start |
| `created_by` | UUID | FK → Users, NOT NULL | Admin who entered the rate |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

## 26. Prisma Notes

### Raw SQL Steps in Migrations
The following constraints cannot be fully expressed in Prisma schema syntax and MUST be added via raw SQL in migration files:
1. **Append-Only Triggers:** Trigger raising an exception on `UPDATE` or `DELETE` for `payroll_ledger` and `subscription_ledger`.
2. **Partial Unique Indexes:**
   - `idx_payroll_ledger_unique_session_credit` on `payroll_ledger(session_id)` WHERE `entry_type = 'SESSION_CREDIT'`.
   - `idx_subscription_ledger_unique_session_deduction` on `subscription_ledger(session_id, subscription_id)` WHERE `entry_type = 'SESSION_DEDUCTION'`.
   - `idx_reports_unique_session_completion` on `reports(session_id, author_id)` WHERE `report_type = 'SESSION_COMPLETION_REPORT'`.
3. **CHECK Constraints:**
   - `CHECK (amount_minor > 0)` on `payroll_ledger` for `SESSION_CREDIT`.
   - `CHECK (amount_minor < 0)` on `payroll_ledger` for `DISBURSEMENT`.
   - `CHECK (sessions_delta = -1)` on `subscription_ledger` for `SESSION_DEDUCTION`.
   - `CHECK (length(currency) = 3)` across financial tables.
   - `CHECK (scheduled_end > scheduled_start)` on `sessions`.
   - `CHECK (scheduled_end > scheduled_start)` and a duration consistency check on `sessions`.
   - `CHECK (length(currency) = 3)` on financial tables.

The duration expression, partial indexes, append-only triggers, and conditional checks are raw SQL because Prisma cannot express them completely.

## 27. Delete Policy
- **NO hard deletes (`ON DELETE RESTRICT`)** on any entity referenced by ledgers (`Users`, `Students`, `Teachers`, `Subscriptions`, `Sessions`).
- Soft deactivation via `is_active = false` or `status = 'CANCELLED'` / `'ENDED'`.

Every ledger foreign key uses `ON DELETE RESTRICT`. No hard delete is allowed for anything referenced by a ledger.

## 28. Open Decisions

- **S2:** Remove `Reports` as a separate history table or retain derived history? Recommend removal of a duplicate attendance table; reports remain the source evidence.
- **S5:** Store `zoom_host_url`? Options: store it encrypted for teacher/Admin convenience, or require the teacher to use the join link. Recommend optional storage, pending owner confirmation.
- **S9:** Attachment allowlist and size cap. Options: images plus PDF with a small cap, images only with a smaller cap, or broader documents with scanning. Recommend images plus PDF, no executables.
- **S14:** Keep `SubscriptionLedger.amount_minor` informational or remove it. Recommend remove; invoices are the money source of truth.
- **S20:** Effective-dated `TeacherRates` versus fields on `Teachers`. Recommend `TeacherRates`.
- **S21:** INTEGER versus BIGINT for money and hourly rounding. Recommend BIGINT if high-volume SaaS growth is expected; rounding remains OPEN.
- **S22:** Zero-session scheduling mechanism. Options: reserve pending sessions, block generation at balance, or allow audited Admin override. Confirm the mechanism; teacher credit must never be blocked.
- Report attendance outcomes, class remarks, homework visibility, notification recipients/timing, guardian visibility of links, evaluation fields, reversal UX, payout cycle, and tenant-scoped uniqueness remain OPEN where noted above.

## Change Summary Labels

- **S1:** Removed Zoom event ingress and event processing fields.
- **S2:** Removed duplicate Attendance/AttendanceSegments history; SessionStudents owns status.
- **S3:** Removed recording and Zoom identifier fields.
- **S4:** Replaced payroll sources with REPORT/ADMIN.
- **S5:** Added required manual join URL and optional host URL decision.
- **S6:** Added session checks and documented status transitions.
- **S7:** Documented optional SessionJoinClicks.
- **S8:** Added one per-student completion report and frozen fields.
- **S9:** Added private report attachments and upload decisions.
- **S10:** Added report/evaluation permission matrix.
- **S11:** Added informational TeacherFlags.
- **S12:** Added MVP SessionRequests.
- **S13:** Kept evaluations optional.
- **S14:** Reworked packages and amount decision.
- **S15:** Added deduction report linkage and partial unique index.
- **S16:** Added one credit per session and rate/minute snapshots.
- **S17:** Added append-only triggers and restricted deletes.
- **S18:** Added financial/session CHECK constraints.
- **S19:** Moved settlement marker to Reports and added consistency checks.
- **S20:** Recommended effective-dated TeacherRates.
- **S21:** Added balance indexes and integer/rounding decisions.
- **S22:** Documented zero-balance options and never-block-pay rule.
- **S23:** Documented enrollment constraints.
- **S24:** Documented three application types and JSONB recommendation.
- **S25:** Added timezone/password fields and username decision.
- **S26:** Added redacted notification content and idempotency.
- **S27:** Added corrected contents, Prisma notes, and delete policy.
- **S28:** Added SaaS hygiene and the open-decisions list.
