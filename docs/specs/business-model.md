# Zarabicschool — Business Model

> Sourced from `docs/CONTEXT.md` and owner-confirmed technical decisions (2026-09-28). Nothing here is invented. Every item is labeled: **Confirmed**, **Open**, or **Proposal**.
>
> Last updated: 2026-09-28

---

## 1. The Four Roles

*Source: CONTEXT.md §4. Status: **Confirmed**.*

| Role | Summary |
|------|---------|
| **Student** | Views own schedule, upcoming/past sessions, join links, recordings (when available), attendance history, announcements. |
| **Guardian** | Centralized view across all linked children: schedules, attendance, recordings, financial status, teacher-written progress reports, updates. One guardian per student (father or mother). The guardian fills the contact/application form on the landing page. |
| **Teacher** | Own schedule, assigned students, session join, past-session log, attendance view, financial/payroll info, writes per-student progress reports, writes mandatory post-session reports, receives student evaluations. |
| **Admin** | Full control: applications/leads, all user accounts, subjects/relationships, schedules, live sessions, attendance, recordings, finances, announcements, reports, replacement sessions, and payroll payouts. Admin provisions all accounts. |

### Relationship rules (Confirmed — owner 2026-09-29)

- One guardian can have **multiple students** (children).
- A student can be an **Adult** (studies independently without a guardian) or a **Minor** (has exactly one guardian: father or mother).
- Teachers ↔ Subjects: **many-to-many**. A teacher can teach multiple subjects; a subject can have multiple teachers.
- Admin and student have freedom to choose subjects and teachers, but **admin confirms** the final assignment.
- Forms: Public landing page has role-specific tabs (Guardian, Student, Teacher). In Teacher application, teacher states expected hourly rate.
- Complaints & Outages: In-app session outage button ("أبلغ عن عطل") next to each session + general complaints button in dashboards.

---

### 2. Onboarding, Authentication & Security

*Source: CONTEXT.md §5 + Confirmed Decisions 2026-09-29. Status: **Confirmed**.*

```
Landing page (public)
  └─→ Applicant (Guardian, Student, or Teacher) fills role-specific application form
        └─→ Admin reviews & validates application
              └─→ Admin approves application
                    └─→ System provisions account (Email + temporary password)
                          └─→ Delivered to user via WhatsApp (OpenWA)
                                └─→ User logs in (rate-limited)
                                      └─→ must_change_password = true forces new password
                                            └─→ Access granted to role-based dashboard
```

- **Admin-Gated Provisioning for 3 Roles:** No public self-registration. Admin reviews applications submitted by Guardians, Students, or Teachers, validates them, and approves account creation.
- **Forced Password Change (`must_change_password`):** On first login, the user is required to set a new password before accessing any platform feature.
- **No Self-Service Password Reset in MVP:** If a user forgets their password, they contact Admin. Admin assigns a new temporary password and sets `must_change_password = true` again.
- **Login Rate Limiting:** Rate limiting on login attempts is required from Phase 1. Local implementation in dev, migrating to Redis when worker infrastructure is introduced.
- **Credential Delivery & Privacy:** WhatsApp (OpenWA) is the primary delivery channel. SMS fallback is deferred to post-MVP (may never be built). In `NotificationLog`, password values are **never stored** (record notification type, recipient, delivery status, and metadata only).

---

## 3. Sessions & Scheduling

*Source: CONTEXT.md §6 + Confirmed Decisions 2026-09-29.*

- **Session Types:** Both **private (1:1)** and **group (1:N)**. Admin configures the session type.
- **Recurring Schedules:** Admin can configure **weekly recurring session patterns** rather than creating every single session manually.
- **Mandatory Zoom REST API Registration:**
  - Creating sessions via Zoom REST API is the primary flow.
  - The system creates the Zoom meeting, registers the teacher and assigned student(s), and generates unique participant-specific join links linked to platform entities.
- **Platform Experience & Mobile Fallback:**
  - The platform provides an embedded Zoom experience via web interface where supported.
  - On mobile devices (or as a fallback), a "Launch in Zoom App" button allows launching the native Zoom client.

---

## 4. Attendance Rules & Absence Thresholds

*Source: Confirmed Decisions 2026-09-29. Status: **Confirmed**.*

### Private Sessions (1:1)
1. Notification sent to student and teacher.
2. System enforces an **absence threshold = 25% of scheduled session duration** (e.g., 15 mins for 60-min session, 30 mins for 120-min session).
3. If student has not joined after 25% duration:
   - Student marked **Absent**.
   - Session marked **Cancelled/Missed**.
   - **Zero financial effect:** Teacher is not paid for a session that did not occur; student subscription quota is not deducted.
4. **Attended Session Consumption:** If the student joins and attends for **at least 25% of scheduled duration**, 1 session is consumed from their package.

### Group Sessions (1:N)
- Attendance tracked individually per student.
- Only attending students (attending >= 25% of duration) consume 1 session from their package quota.
- Absent students are not deducted.
- Teacher is paid for the billable time spent with **at least one student**.
- Teacher submits one comprehensive session report.

### Teacher Attendance
- Teacher attendance is tracked via Zoom participant events.
- Actual duration is calculated after meeting ends.
- Informational late arrival alert sent if teacher joins >3 minutes late (**no payroll penalty and no red mark**).
- **If teacher does not join: No payroll is generated.**

### Technical / Internet Outages & Replacement Sessions ("أبلغ عن عطل")
- Included in **MVP**: An in-app outage report form allows students or teachers to report technical failures (internet cutoff, power outage, Zoom/device issue).
- Admin reviews the report.
- Upon approval, Admin schedules a **replacement session** linked to the original missed session (`replacement_for_session_id`).
- The original missed session has **0 effect** on student balance and teacher pay. The replacement session settles balance deduction and payroll accrual when successfully completed.

---

## 5. Automatic Payroll & Subscription Financial Model

*Source: CONTEXT.md §7 + Confirmed Decisions 2026-09-29. Status: **Confirmed** (HIGH RISK).*

### The Core Financial Invariant
> **Settlement is automatic and driven by Zoom-verified attendance in ONE atomic database transaction.**

1. **Teacher Side (Hourly):**
   - Billable time = overlap period where teacher AND at least one student were present in the Zoom meeting.
   - Default cap = scheduled session duration. If a session runs over, the teacher notes overtime in the post-session report, and Admin approves/credits overtime via `ADMIN_ADJUSTMENT`.
   - Hourly rate is configured per teacher on the teacher profile; every `SESSION_CREDIT` records an immutable `hourly_rate_snapshot_minor` at settlement time.
2. **Student Side (Prepaid Session Packages):**
   - Prepaid packages (e.g., 8 sessions), with **no expiration date**.
   - Each completed session attended by the student consumes **1 session** (`SESSION_DEDUCTION`).
   - If a student's package is exhausted (0 balance), the teacher is **still paid** for work performed; the deduction records negative balance with an Admin alert for quota replenishment.
3. **Teacher Post-Session Report:**
   - Mandatory for quality review and educational notes; it does **NOT** gate payroll settlement.
   - Escalation: T+0 reminder, T+15m reminder, T+30m **red mark** recorded on teacher profile.
4. **Atomic Settlement Execution:** In a single database transaction upon `meeting.ended` (or reconciliation):
   - Deduct 1 session from each attending student in `SubscriptionLedger`.
   - Credit teacher in `PayrollLedger` based on billable time × hourly rate.
   - Set `financially_settled_at` on the `Sessions` record.

```
Zoom meeting.ended
  │
  ├─► Overlap duration calculated (Teacher + >=1 Student)
  │
  ▼ (Single Atomic DB Transaction)
┌─────────────────────────────────────────┐
│ 1. SubscriptionLedger: -1 session/attendee│
│ 2. PayrollLedger: Credit (hours × rate) │
│ 3. Sessions.financially_settled_at = now()│
└─────────────────────────────────────────┘
  │
  ├─► Trigger WhatsApp prompt to Teacher for Session Report
  └─► Trigger WhatsApp prompt to Student for Optional Evaluation
```

### Dual Ledger Architecture
1. **`SubscriptionLedger` (Student balance):**
   - No mutable independent counters.
   - Core subscription holds configuration (total sessions, per-session price, currency).
   - Balance changes are append-only rows: `INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND`.
   - Remaining balance is computed from ledger entries.
2. **`PayrollLedger` (Teacher balance):**
   - Append-only. Never UPDATE or DELETE.
   - `created_by = NULL` for system-generated entries; `NOT NULL` for Admin manual adjustments.
   - Enforced by database partial unique index:
     ```sql
     CREATE UNIQUE INDEX ON payroll_ledger (session_id, student_id)
     WHERE entry_type = 'SESSION_CREDIT';
     ```

### Multi-Currency & Payouts
- Multi-currency supported across all financial records (ISO codes: `USD`, `EGP`).
- **No automated currency conversion in MVP.**
- Teacher earnings are tracked per currency (e.g., USD balance: $120; EGP balance: 4,500 EGP).
- Admin manually reviews accrued balances, performs conversions if necessary, and approves payouts/disbursements.

### Idempotency & Provider Event Safety
- Zoom events use compound unique keys (`event_key`):
  - Meeting-level: `meeting_uuid + ':' + event_type`
  - Participant-level: `meeting_uuid + ':' + event_type + ':' + participant_uuid + ':' + event_time` (handles leave/rejoin safely)
- Combined with a `processed_at` timestamp and retry queue.

---

## 6. Student Payment (Manual) & Storage

*Source: CONTEXT.md §12 + Confirmed Decisions 2026-09-28. Status: **Confirmed**.*

1. Student/guardian submits payment proof (receipt image or transaction reference).
2. **Storage:** Proof images uploaded to a private **Supabase Storage** bucket. Database stores `file_path` (never file content). Accessed via temporary signed URLs.
3. Invoice marked `PENDING`.
4. Admin reviews against bank/wallet account.
5. Admin confirms $\rightarrow$ Invoice marked `PAID` $\rightarrow$ `SubscriptionLedger` credited with `INITIAL_PURCHASE`.

---

## 7. WhatsApp Notifications & Low-Balance Alert

*Source: CONTEXT.md §6, §8 + Confirmed Decisions 2026-09-28.*

- **Provider:** OpenWA (unofficial, self-hosted) behind `MessagingProvider`.
- **Scheduled Notifications:** Executed when configured time arrives (session reminders, alerts).
- **Events & Targets:**
  - Session scheduled $\rightarrow$ Teacher notification.
  - 2 hours prior $\rightarrow$ Teacher reminder.
  - Teacher >3 min late $\rightarrow$ Teacher informational alert.
  - Teacher joins meeting $\rightarrow$ Students receive notification.
  - Student joins meeting $\rightarrow$ Guardian receives alert (open to finalize).
- **Low-Balance Warning:** Optional alert triggered when approximately **75% of purchased sessions are used** (25% balance remaining).

---

## 8. Deployment, Channels & Timeline (Confirmed Decisions)

| Topic | Decision | Status |
|-------|----------|--------|
| **Hosting & Worker Model** | **VPS** (e.g. Hetzner / DigitalOcean) hosting the long-running Node processes (persistent Zoom WebSocket consumer, OpenWA WhatsApp worker, BullMQ queue workers) alongside the Next.js app / reverse proxy. | **Confirmed** (owner 2026-09-28) |
| **Credential Delivery Fallback** | **SMS** is the confirmed fallback channel if WhatsApp (OpenWA) is down, disconnected, or blocked. | **Confirmed** (owner 2026-09-28) |
| **Project Target Timeline** | **1 month to maximum 1.5 months (4–6 weeks)** total delivery target. | **Confirmed** (owner 2026-09-28) |
| **Zoom Plan & Cost** | Verify plan supports Server-to-Server OAuth, REST registration endpoints, and WebSocket events. Inform Alaa regarding Zoom costs. | **Open Action Item** |
| **Postgres Database Host** | Supabase (transaction-mode pooler for `DATABASE_URL`, direct connection for `DIRECT_URL` migrations). | **Confirmed** |
