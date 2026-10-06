# Zarabicschool — Business Model

> Sourced from `docs/CONTEXT.md` and owner-confirmed technical decisions (2026-10-06). Nothing here is invented. Every item is labeled: **Confirmed**, **Open**, or **Proposal**.
>
> Last updated: 2026-10-06

---

## 1. The Four Roles

*Source: CONTEXT.md §4. Status: **Confirmed**.*

| Role | Summary |
|------|---------|
| **Student** | Views own schedule, upcoming/past sessions, join links, attendance history, announcements. |
| **Guardian** | Centralized view across linked children: schedules, attendance, financial status, teacher reports, and updates. Adult-student handling is OPEN. |
| **Teacher** | Own schedule, assigned students, session join, past-session log, attendance view, financial/payroll info, writes per-student progress reports, writes mandatory post-session reports, receives student evaluations. |
| **Admin** | Full control: applications, accounts, subjects/relationships, schedules and pasted Zoom links, reports, outage requests, finances, payroll adjustments, payouts, and announcements. |
| **Supervisor** | Same operational controls as Admin, including report approval, but no money fields/actions and no Admin/Supervisor management. |

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
**Platform Experience:**
  - The platform provides a private Zoom join button/link for each participant.
  - Clicking the button opens Zoom externally in the desktop app, native mobile app, or Zoom browser experience.
  - The platform does not host a Zoom interface and does not provide video recording playback in the MVP.
- **Session Types:** Both **private (1:1)** and **group (1:N)**. Admin configures the session type.
- **Recurring Schedules:** Admin can configure **weekly recurring session patterns** rather than creating every single session manually.
- **Manual Zoom links (confirmed):** Admin creates the meeting in Zoom and pastes the required link into the session. There is no Zoom API, registration, event consumer, recording, reconciliation, or embedded interface.
- **Platform Experience:**
  - The platform provides a private Zoom join button/link for each participant.
  - Clicking the button opens Zoom externally in the desktop app, native mobile app, or Zoom browser experience.
  - The platform does not host a Zoom interface and does not provide video recording playback in the MVP.

---

## 4. Attendance Rules & Teacher Reports

*Source: CONTEXT.md §6-7. Status: **Confirmed**.*

The platform cannot verify attendance. The teacher's per-student report is evidence for an explicit attendance write and a financial review request. `SessionStudents.attendance_status` is persisted as `PENDING`, `ATTENDED`, or `STUDENT_ABSENT`; Admin or Supervisor approval is required, and Admin overrides require an actor and reason. Evaluation is separate and missing evaluation never means absence.

### Private Sessions (1:1)
1. Notification sent to student and teacher.
2. The teacher records the outcome in a report after the scheduled end.
3. If the teacher reports the student absent:
   - Student marked **STUDENT_ABSENT** after Admin or Supervisor approval.
   - The session is marked **MISSED** only when the session itself did not take place; a completed group session may include absent students.
   - **Zero financial effect:** Teacher is not paid for that student's absence; that student's subscription quota is not deducted.
4. An attended report consumes one prepaid session and settles teacher pay atomically.

### Group Sessions (1:N)
- Attendance tracked individually per student.
- Each student outcome is recorded independently in that student's report.
- Absent students are not deducted.
- Teacher pay uses scheduled duration and is created once per session by the first attended report.
- Teacher submits one report per student.

### Teacher Attendance
- Teacher attendance is not machine-verified. A missed or not-held outcome produces no settlement.

### Technical / Internet Outages & Replacement Sessions ("أبلغ عن عطل")
- Included in **MVP**: An in-app outage report form allows students or teachers to report technical failures (internet cutoff, power outage, Zoom/device issue).
- Admin reviews the report.
- Upon approval, Admin schedules a **replacement session** linked to the original missed session (`replacement_for_session_id`).
- The original missed session has **0 effect** on student balance and teacher pay. The replacement session settles balance deduction and payroll accrual when successfully completed.

---

## 5. Automatic Payroll & Subscription Financial Model

*Source: CONTEXT.md §7 + Confirmed Decisions 2026-09-29. Status: **Confirmed** (HIGH RISK).*

### The Core Financial Invariant
> **Settlement is triggered only after Admin or Supervisor approves the teacher's report, in ONE atomic database transaction.**

1. **Teacher Side (Hourly):**
  - Pay basis is scheduled duration, not observed Zoom time. If the teacher stayed longer, she claims overtime in the report and Admin approves it via `ADMIN_ADJUSTMENT`.
  - Every `SESSION_CREDIT` records an immutable `hourly_rate_snapshot_minor` at settlement time.
2. **Student Side (Prepaid Session Packages):**
   - Monthly plans grant 8 sessions (or an Admin-defined tier) for the billing period; unused monthly sessions do **not** roll over. The separate pay-per-session purchase never expires.
   - Each completed session attended by the student consumes **1 session** (`SESSION_DEDUCTION`).
   - If a student's package is exhausted (0 balance), the teacher is **still paid** for work performed; the deduction records negative balance with an Admin alert for quota replenishment.
3. **Teacher Post-Session Report:**
  - Mandatory for quality review and educational notes; it **gates teacher payroll settlement**.
  - In group sessions, the teacher submits one report per student, while the teacher credit is created once per session by the first attended report.
   - Escalation: T+0 reminder, T+15m reminder, T+30m **red mark** recorded on teacher profile.
4. **Financial Execution:**
  - When an attended report is approved by Admin or Supervisor, deduct one session for that student, create the first session credit, set `Reports.settled_at`, and archive the report together. Submission alone creates no ledger row.

```
Teacher submits attended report
  │
  │
  ▼ Admin/Supervisor approval (single atomic DB transaction)
┌─────────────────────────────────────────┐
│ 1. SubscriptionLedger: -1 session/attendee│
│ 2. PayrollLedger: Credit (hours × rate) │
│ 3. Reports.settled_at + archived_at = now()│
└─────────────────────────────────────────┘
  │
  ├─► Trigger WhatsApp prompt to Teacher for Session Report
  └─► Trigger WhatsApp prompt to Student for Optional Evaluation
```

### Dual Ledger Architecture
1. **`SubscriptionLedger` (Student balance):**
   - No mutable independent counters.
  - Core subscription holds configuration (total sessions, package price, currency).
   - Balance changes are append-only rows: `INITIAL_PURCHASE`, `SESSION_DEDUCTION`, `ADMIN_ADJUSTMENT`, `REFUND`.
   - Remaining balance is computed from ledger entries.
2. **`PayrollLedger` (Teacher balance):**
   - Append-only. Never UPDATE or DELETE.
   - `created_by = NULL` for system-generated entries; `NOT NULL` for Admin manual adjustments.
   - Enforced by database partial unique index:
     ```sql
     CREATE UNIQUE INDEX ON payroll_ledger (session_id)
     WHERE entry_type = 'SESSION_CREDIT';
     ```

### Multi-Currency & Payouts
- Multi-currency supported across all financial records (ISO codes: `USD`, `EGP`).
- **No automated currency conversion in MVP.**
- Teacher earnings are tracked per currency (e.g., USD balance: $120; EGP balance: 4,500 EGP).
- Admin manually reviews accrued balances, performs conversions if necessary, and approves payouts/disbursements.

### Idempotency & consistency
- One report per `(session_id, student_id)` prevents duplicate claims; a database unique constraint makes retries idempotent.
- One `SESSION_DEDUCTION` per `(session, subscription)` and one `SESSION_CREDIT` per session prevent double settlement.
- A periodic consistency query finds settled reports without ledger rows and ledger rows without a settled report.

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
- **Low-Balance Warning:** Optional post-MVP alert; no threshold is confirmed.

---

## 8. Deployment, Channels & Timeline (Confirmed Decisions)

| Topic | Decision | Status |
|-------|----------|--------|
| **Hosting & Worker Model** | Hosting is decided at deployment; OpenWA and timed notifications need a continuously running process. | **Open** |
| **Credential Delivery Fallback** | **SMS** is the confirmed fallback channel if WhatsApp (OpenWA) is down, disconnected, or blocked. | **Confirmed** (owner 2026-09-28) |
| **Project Target Timeline** | **1 month to maximum 1.5 months (4–6 weeks)** total delivery target. | **Confirmed** (owner 2026-09-28) |
| **Zoom Plan & Cost** | Confirm the academy's normal Zoom plan and cost for externally created meetings; no platform API capability is required. | **Open Action Item** |
| **Postgres Database Host** | Supabase (transaction-mode pooler for `DATABASE_URL`, direct connection for `DIRECT_URL` migrations). | **Confirmed** |

## 9. Post-delivery SaaS roadmap

Documented only for later delivery: multi-academy onboarding and billing, tenant administration, RLS and tenant switching, tenant-scoped uniqueness, provider configuration, audit/observability improvements, and an optional future Zoom verification layer. No current phase creates tasks for this roadmap.
