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
8. [Enrollments](#8-enrollments)
9. [Applications](#9-applications)
10. [Sessions](#10-sessions)
11. [SessionStudents](#11-sessionstudents)
12. [Attendance](#12-attendance)
13. [AttendanceSegments](#13-attendancesegments)
14. [Subscriptions](#14-subscriptions)
15. [SubscriptionLedger](#15-subscriptionledger)
16. [Invoices](#16-invoices)
17. [PaymentProofs](#17-paymentproofs)
18. [PayrollLedger](#18-payrolledger)
19. [ZoomEvents](#19-zoomevents)
20. [Reports](#20-reports)
21. [TeacherFlags](#21-teacherflags-النقطة-الحمراء)
22. [OutageReports](#22-outagereports-أبلغ-عن-عطل)
23. [Evaluations](#23-evaluations)
24. [Complaints](#24-complaints-شكاوى-واقتراحات)
25. [Announcements](#25-announcements)
26. [NotificationLog](#26-notificationlog)
27. [Recordings](#27-recordings)
28. [Prisma Raw SQL Notes & Delete Policy](#28-prisma-raw-sql-notes--delete-policy)

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
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `hourly_rate_minor` | INTEGER | NOT NULL, DEFAULT 0 | Hourly rate agreed with academy (e.g. in piasters/cents) |
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

## 9. Applications

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
| `zoom_meeting_id` | VARCHAR | UNIQUE, nullable | Created via Zoom REST API |
| `zoom_meeting_uuid` | VARCHAR | UNIQUE, nullable | Unique Zoom instance identifier |
| `zoom_start_url` | TEXT | nullable | Teacher host launch URL (Security: never logged, teacher/admin only) |
| `status` | ENUM | DEFAULT 'SCHEDULED' | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `MISSED`, `CANCELLED` |
| `is_recurring` | BOOLEAN | DEFAULT false | Part of weekly recurring schedule |
| `recurrence_rule` | VARCHAR | nullable | e.g. "WEEKLY:MON,THU:18:00" |
| `recurrence_group_id` | UUID | nullable | Links weekly recurring session series |
| `replacement_for_session_id` | UUID | FK → Sessions, nullable | Links replacement session to missed original |
| `cancellation_reason` | TEXT | nullable | Technical outage, absence notes, etc. |
| `financially_settled_at` | TIMESTAMPTZ | nullable | Settlement marker: set atomically with ledgers; never cleared; never editable |
| `created_by` | UUID | FK → Users, NOT NULL | Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

> **Security Note:** `zoom_start_url` contains host privileges. Must be accessed ONLY by Admin and the assigned teacher at meeting time. Never exposed to students or logged.

---

## 11. SessionStudents

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

> **Security Note:** `zoom_join_url` is private to the registered student and guardian. Never exposed in unauthenticated responses.

---

## 12. Attendance

Granular session participation log per user. Driven by Zoom events (primary) or manual admin override.

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
| `overridden_by` | UUID | FK → Users, nullable | Required when source = 'MANUAL' |
| `override_reason` | TEXT | nullable | Mandatory audit explanation when source = 'MANUAL' |
| `zoom_event_id` | UUID | FK → ZoomEvents, nullable | Source event for audit |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| | | UNIQUE(session_id, user_id) | Exactly one attendance row per user per session |

---

## 13. AttendanceSegments

Tracks granular join/leave intervals to accurately compute teacher–student overlap for billable time.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `attendance_id` | UUID | FK → Attendance, NOT NULL | Linked participant attendance record |
| `joined_at` | TIMESTAMPTZ | NOT NULL | Timestamp when participant joined/rejoined |
| `left_at` | TIMESTAMPTZ | nullable | Timestamp when participant left (closed at meeting end if missing) |
| `zoom_event_id` | UUID | FK → ZoomEvents, nullable | Zoom event source |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

> **Computation Invariant:** To calculate billable time:
> 1. Compute the time intersection between the teacher's segments and each attending student's segments.
> 2. Take the **UNION** across all students so overlapping students in group sessions are not counted twice.
> 3. Cap billable duration at the scheduled session duration (unless Admin manually approves overtime).
> 4. Round to the nearest minute.

---

## 14. Subscriptions

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

> **Business Rule (Confirmed):** Packages have no time-based expiration date. `per_session_price_minor` was removed because student package consumption is 1 session per attended class, and teacher pay is hourly and completely independent.

---

## 15. SubscriptionLedger

Append-only ledger tracking all quota mutations to a student's subscription. Balance is computed from `SUM(sessions_delta)`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `subscription_id` | UUID | FK → Subscriptions, NOT NULL | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `entry_type` | ENUM | NOT NULL | `INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND` |
| `sessions_delta` | INTEGER | NOT NULL | (+N for purchase, -1 for session deduction) |
| `amount_minor` | INTEGER | DEFAULT 0 | Informational minor units (true financial truth is on Invoices) |
| `currency` | VARCHAR(3) | NOT NULL | Must match subscription currency |
| `session_id` | UUID | FK → Sessions, nullable | Linked session for deductions |
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

## 16. Invoices

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

## 17. PaymentProofs

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

## 18. PayrollLedger

**Append-only teacher financial ledger.** Tracks all earnings and manual adjustments per currency.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `teacher_id` | UUID | FK → Teachers, NOT NULL | |
| `session_id` | UUID | FK → Sessions, nullable | Session that generated payment |
| `zoom_event_id` | UUID | FK → ZoomEvents, nullable | Auditing link |
| `amount_minor` | INTEGER | NOT NULL | Minor units (+ credit, - debit/disbursement) |
| `currency` | VARCHAR(3) | NOT NULL | ISO 4217 code |
| `hourly_rate_snapshot_minor` | INTEGER | NOT NULL | Snapshot of teacher hourly rate at calculation time |
| `billable_seconds` | INTEGER | NOT NULL | Overlap duration (teacher + >=1 student) capped at scheduled duration |
| `entry_type` | ENUM | NOT NULL | `SESSION_CREDIT`, `ADMIN_ADJUSTMENT`, `DISBURSEMENT` |
| `source` | ENUM | NOT NULL | `LIVE_WEBSOCKET`, `RECONCILIATION`, `ADMIN` |
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

## 19. ZoomEvents

Raw Zoom event ingress buffer. Guarantees deduplication, idempotent consumption, and auditability.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `event_key` | VARCHAR | UNIQUE, NOT NULL | Unique deduplication key generated by shared helper |
| `zoom_meeting_id` | VARCHAR | NOT NULL | |
| `event_type` | VARCHAR | NOT NULL | Standardized Zoom event name (e.g. `meeting.started`, `meeting.ended`) |
| `participant_zoom_id` | VARCHAR | nullable | |
| `payload` | JSONB | NOT NULL | Untampered event payload |
| `source` | ENUM | NOT NULL | `LIVE_WEBSOCKET`, `RECONCILIATION` |
| `processing_attempts` | INTEGER | DEFAULT 0 | Number of worker processing attempts |
| `received_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `processed_at` | TIMESTAMPTZ | nullable | Ingested and attendance evaluated |
| `processing_error` | TEXT | nullable | Error trace if processing failed |

---

## 20. Reports

Progress reports and post-session logs.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, nullable | Linked session |
| `author_id` | UUID | FK → Users, NOT NULL | |
| `target_id` | UUID | FK → Users, NOT NULL | Target user (e.g. Student) |
| `content` | TEXT | NOT NULL | Qualitative notes (e.g., Quran surah covered, homework, overtime request) |
| `report_type` | ENUM | NOT NULL | `SESSION_COMPLETION_REPORT`, `TEACHER_PROGRESS_REPORT`, `FEEDBACK_REPORT` |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

### Report Uniqueness Guard
```sql
CREATE UNIQUE INDEX idx_reports_unique_session_completion
ON reports (session_id, author_id)
WHERE report_type = 'SESSION_COMPLETION_REPORT';
```

---

## 21. TeacherFlags ("النقطة الحمراء")

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

## 22. OutageReports ("أبلغ عن عطل")

In-app technical outage reports submitted by students or teachers for missed or disrupted sessions.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | Affected session (bound automatically from session button) |
| `reporter_id` | UUID | FK → Users, NOT NULL | User reporting the outage (Student/Teacher) |
| `issue_category` | ENUM | NOT NULL | `INTERNET_OUTAGE`, `ELECTRICITY_CUT`, `ZOOM_ISSUE`, `DEVICE_FAILURE`, `OTHER` |
| `description` | TEXT | NOT NULL | Details of the technical failure |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `APPROVED_REPLACEMENT_SCHEDULED`, `REJECTED` |
| `reviewed_by` | UUID | FK → Users, nullable | Admin who reviewed |
| `reviewed_at` | TIMESTAMPTZ | nullable | |
| `replacement_session_id` | UUID | FK → Sessions, nullable | Linked replacement session if approved |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 23. Evaluations

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

## 24. Complaints ("شكاوى واقتراحات")

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

## 25. Announcements

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

## 26. NotificationLog

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
| `content` | TEXT | NOT NULL | Template key / metadata; **never plaintext passwords** |
| `status` | ENUM | DEFAULT 'PENDING' | `PENDING`, `SENT`, `FAILED` |
| `sent_at` | TIMESTAMPTZ | nullable | |
| `error` | TEXT | nullable | Provider error details |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |

---

## 27. Recordings

*Deferred capability.* Video storage references.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | |
| `academy_id` | UUID | FK → Academies, NOT NULL | |
| `session_id` | UUID | FK → Sessions, NOT NULL | |
| `storage_url` | VARCHAR | NOT NULL | Cloud storage URL |
| `duration_seconds` | INTEGER | nullable | |
| `uploaded_by` | UUID | FK → Users, NOT NULL | Admin |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | | |

---

## 28. Prisma Raw SQL Notes & Delete Policy

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
   - `CHECK (left_at >= joined_at)` on `attendance_segments`.

### Delete Policy
- **NO hard deletes (`ON DELETE RESTRICT`)** on any entity referenced by ledgers (`Users`, `Students`, `Teachers`, `Subscriptions`, `Sessions`).
- Soft deactivation via `is_active = false` or `status = 'CANCELLED'` / `'ENDED'`.
