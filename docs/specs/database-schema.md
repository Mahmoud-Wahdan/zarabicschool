# Zarabicschool — Database Schema

> **Status: Architecture Aligned — Updated with Confirmed Decisions (2026-09-28).**
>
> **Conventions:**
> - All IDs are `UUID` (generated via `gen_random_uuid()`).
> - All tenant-owned tables have an `academy_id` FK (single UUID, seeded once — not an env var).
> - Money is stored as **integer minor units** (cents, piasters, etc.) — never floats.
> - Currency is stored as **ISO 4217 code** (`VARCHAR(3)`) — multi-currency supported, balances tracked per currency.
> - Timestamps are `TIMESTAMPTZ` (timezone-aware).
> - Dual-ledger financial design: `SubscriptionLedger` for student balance, `PayrollLedger` for teacher compensation.
>
> Last updated: 2026-09-28

---

## Table of Contents

1. [Academies](#1-academies)
2. [Users](#2-users)
3. [Guardians](#3-guardians)
4. [Students](#4-students)
5. [Teachers](#5-teachers)
6. [Subjects](#6-subjects)
7. [TeacherSubjects](#7-teachersubjects)
8. [Applications](#8-applications)
9. [Sessions](#9-sessions)
10. [SessionStudents](#10-sessionstudents)
11. [Attendance](#11-attendance)
12. [Subscriptions](#12-subscriptions)
13. [SubscriptionLedger](#13-subscriptionledger)
14. [Invoices](#14-invoices)
15. [PaymentProofs](#15-paymentproofs)
16. [PayrollLedger](#16-payrolledger)
17. [ZoomEvents](#17-zoomevents)
18. [Reports](#18-reports)
19. [Evaluations](#18-evaluations)
20. [Announcements](#20-announcements)
21. [NotificationLog](#21-notificationlog)
22. [Recordings](#22-recordings)

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
| `email` | VARCHAR | UNIQUE, NOT NULL | Created by admin |
| `password_hash` | VARCHAR | NOT NULL | Stored via bcrypt/argon2 |
| `display_name` | VARCHAR | NOT NULL | |
| `phone` | VARCHAR | | For WhatsApp notifications |
| `role` | ENUM | NOT NULL | `ADMIN`, `TEACHER`, `STUDENT`, `GUARDIAN` |
| `is_active` | BOOLEAN | DEFAULT true | Admin can deactivate |
| `must_change_password` | BOOLEAN | DEFAULT true | **Confirmed:** Forced password reset on first login |
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
| `guardian_id` | UUID | FK → Guardians, NOT NULL | Exactly one guardian per student |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `zoom_registrant_id` | VARCHAR | nullable | Registered via Zoom REST API |
| `enrollment_date` | DATE | | |
| `timezone` | VARCHAR | | Stored for schedule localization |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 5. Teachers

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `user_id` | UUID | FK → Users, UNIQUE, NOT NULL | 1:1 with Users |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `zoom_registrant_id` | VARCHAR | nullable | Registered via Zoom REST API |
| `timezone` | VARCHAR | | Stored for schedule localization |
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

## 8. Applications

Inbound leads from landing page contact forms (filled by guardians).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `applicant_name` | VARCHAR | NOT NULL | Guardian name |
| `applicant_email` | VARCHAR | | |
| `applicant_phone` | VARCHAR | NOT NULL | Contact number for initial outreach |
| `applicant_relationship` | ENUM | | `FATHER`, `MOTHER` |
| `student_name` | VARCHAR | | Child's name |
| `message` | TEXT | | Notes from lead |
| `status` | ENUM | DEFAULT 'NEW' | `NEW`, `REVIEWED`, `APPROVED`, `REJECTED` |
| `reviewed_by` | UUID | FK → Users, nullable | Admin who reviewed |
| `reviewed_at` | TIMESTAMPTZ | nullable | |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 9. Sessions

Represents scheduled live learning meetings.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `subject_id` | UUID | FK → Subjects, NOT NULL | |
| `session_type` | ENUM | NOT NULL | `PRIVATE` (1:1), `GROUP` (1:N) |
| `scheduled_start` | TIMESTAMPTZ | NOT NULL | |
| `scheduled_end` | TIMESTAMPTZ | NOT NULL | |
| `duration_minutes` | INTEGER | NOT NULL | Calculated duration |
| `zoom_meeting_id` | VARCHAR | | Created via Zoom REST API |
| `zoom_meeting_uuid` | VARCHAR | | Unique Zoom instance identifier |
| `zoom_start_url` | TEXT | | Teacher host launch URL |
| `status` | ENUM | DEFAULT 'SCHEDULED' | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `MISSED`, `CANCELLED` |
| `is_recurring` | BOOLEAN | DEFAULT false | Part of weekly recurring schedule |
| `recurrence_rule` | VARCHAR | nullable | e.g. "WEEKLY:MON,THU:18:00" |
| `replacement_for_session_id` | UUID | FK → Sessions, nullable | Links replacement session to missed original |
| `cancellation_reason` | TEXT | nullable | Technical outage, absence notes, etc. |
| `created_by` | UUID | FK → Users, NOT NULL | Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 10. SessionStudents

Junction mapping participants to sessions with their unique Zoom registration details.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `zoom_join_url` | TEXT | NOT NULL | Participant-specific join URL from Zoom REST API |
| `zoom_registrant_id` | VARCHAR | | Unique Zoom registrant ID |
| | | UNIQUE(session_id, student_id) | |

---

## 11. Attendance

Granular session participation log. Driven by Zoom events (primary) or manual admin override.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `user_id` | UUID | FK → Users, NOT NULL | Teacher or Student |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `role_in_session` | ENUM | NOT NULL | `TEACHER`, `STUDENT` |
| `joined_at` | TIMESTAMPTZ | | First join timestamp |
| `left_at` | TIMESTAMPTZ | nullable | Final leave timestamp |
| `total_duration_seconds` | INTEGER | DEFAULT 0 | Cumulative attended duration |
| `is_late` | BOOLEAN | DEFAULT false | >3 min late for teacher (informational only) |
| `is_absent` | BOOLEAN | DEFAULT false | True if student exceeds 25% absence threshold |
| `source` | ENUM | NOT NULL | `ZOOM_EVENT`, `MANUAL` |
| `zoom_event_id` | UUID | FK → ZoomEvents, nullable | Source event for audit |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 12. Subscriptions

Stores core configuration for student prepayments. Balances are derived from `SubscriptionLedger`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `total_amount_minor` | INTEGER | NOT NULL | Initial price in minor units |
| `currency` | VARCHAR(3) | NOT NULL | ISO 4217 code (`USD`, `EGP`) |
| `per_session_price_minor` | INTEGER | NOT NULL | Deduction per completed session |
| `sessions_purchased` | INTEGER | NOT NULL | Total sessions bought |
| `status` | ENUM | DEFAULT 'ACTIVE' | `ACTIVE`, `EXHAUSTED`, `CANCELLED` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 13. SubscriptionLedger

**Option B: Ledger-Based Balance.** Append-only ledger tracking all credit and debit mutations to a student's subscription.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `subscription_id` | UUID | FK → Subscriptions, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `entry_type` | ENUM | NOT NULL | `INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND` |
| `amount_minor` | INTEGER | NOT NULL | Value (+ for credit, - for deduction) |
| `currency` | VARCHAR(3) | NOT NULL | Must match subscription currency |
| `sessions_delta` | INTEGER | NOT NULL | (+N for purchase, -1 for session) |
| `session_id` | UUID | FK → Sessions, nullable | Linked session for deductions |
| `description` | TEXT | nullable | Audit explanation |
| `created_by` | UUID | FK → Users, nullable | NULL = system-generated; NOT NULL = Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 14. Invoices

Manual billing records generated for student subscription packages.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `student_id` | UUID | FK → Students, NOT NULL | |
| `subscription_id` | UUID | FK → Subscriptions, nullable | |
| `amount_minor` | INTEGER | NOT NULL | Total payable |
| `currency` | VARCHAR(3) | NOT NULL | |
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
| `student_id` | UUID | FK → Students, nullable | Student associated with session credit |
| `session_id` | UUID | FK → Sessions, nullable | Session that generated payment |
| `zoom_event_id` | UUID | FK → ZoomEvents, nullable | Auditing link |
| `amount_minor` | INTEGER | NOT NULL | Minor units (+ credit, - debit) |
| `currency` | VARCHAR(3) | NOT NULL | ISO 4217 code |
| `entry_type` | ENUM | NOT NULL | `SESSION_CREDIT`, `ADMIN_ADJUSTMENT`, `DISBURSEMENT` |
| `source` | ENUM | NOT NULL | `LIVE_WEBSOCKET`, `RECONCILIATION`, `ADMIN` |
| `description` | TEXT | nullable | Mandatory for admin adjustments |
| `created_by` | UUID | FK → Users, nullable | **Confirmed:** NULL = system-generated; NOT NULL = Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

### Database Idempotency Constraint
```sql
CREATE UNIQUE INDEX idx_payroll_ledger_unique_session_credit
ON payroll_ledger (session_id, student_id)
WHERE entry_type = 'SESSION_CREDIT';
```

---

## 17. ZoomEvents

Raw Zoom event ingress buffer. Guarantees deduplication and auditability.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `event_key` | VARCHAR | UNIQUE, NOT NULL | Unique event deduplication key |
| `zoom_meeting_id` | VARCHAR | NOT NULL | |
| `event_type` | VARCHAR | NOT NULL | `meeting.started`, `meeting.ended`, `participant.joined`, etc. |
| `participant_zoom_id` | VARCHAR | nullable | |
| `payload` | JSONB | NOT NULL | Untampered event payload |
| `source` | ENUM | NOT NULL | `LIVE_WEBSOCKET`, `RECONCILIATION` |
| `received_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `processed_at` | TIMESTAMPTZ | nullable | NULL = pending processing (retry candidate) |
| `processing_error` | TEXT | nullable | Error trace if processing failed |

### Compound Event Key Rules
- **Meeting-level events:** `${meeting_uuid}:${event_type}`
- **Participant-level events:** `${meeting_uuid}:${event_type}:${participant_uuid}:${event_time}` (allows valid rejoins)

---

## 18. Reports

Progress reports and session completion logs.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, nullable | Linked session |
| `author_id` | UUID | FK → Users, NOT NULL | |
| `target_id` | UUID | FK → Users, NOT NULL | Target user (e.g. Student) |
| `content` | TEXT | NOT NULL | Qualitative notes |
| `report_type` | ENUM | NOT NULL | `SESSION_COMPLETION_REPORT`, `TEACHER_PROGRESS_REPORT`, `FEEDBACK_REPORT` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

*Note:* `SESSION_COMPLETION_REPORT` submitted by the teacher is the mandatory prerequisite that unlocks payroll calculation for that session.

---

## 19. Evaluations

Post-session structured rating forms filled by students about teachers.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `evaluator_id` | UUID | FK → Users, NOT NULL | Student |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | Teacher |
| `responses` | JSONB | NOT NULL | Structured responses |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 20. Announcements

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

## 21. NotificationLog

Auditing log for WhatsApp and SMS communications.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `recipient_id` | UUID | FK → Users, NOT NULL | |
| `channel` | ENUM | DEFAULT 'WHATSAPP' | `WHATSAPP`, `SMS`, `EMAIL` |
| `notification_type` | VARCHAR | NOT NULL | `SESSION_REMINDER`, `LATE_ARRIVAL`, `CREDENTIALS`, etc. |
| `content` | TEXT | NOT NULL | **Security:** Never store plaintext passwords for `CREDENTIALS` |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `SENT`, `FAILED` |
| `sent_at` | TIMESTAMPTZ | nullable | |
| `error` | TEXT | nullable | Provider error details |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 22. Recordings

*Deferred capability.* Video storage references on Cloudinary.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `cloudinary_url` | VARCHAR | NOT NULL | |
| `cloudinary_public_id` | VARCHAR | NOT NULL | |
| `duration_seconds` | INTEGER | nullable | |
| `uploaded_by` | UUID | FK → Users, NOT NULL | Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |
