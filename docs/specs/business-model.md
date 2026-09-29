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

### Relationship rules (Confirmed — owner 2026-09-28)

- One guardian can have **multiple students** (children).
- One student has **exactly one guardian** (father or mother).
- Teachers ↔ Subjects: **many-to-many**. A teacher can teach multiple subjects; a subject can have multiple teachers.
- Admin and student have freedom to choose subjects and teachers, but **admin confirms** the final assignment.
- Forms: Role-specific tabs and sections expose only the fields relevant to each role.

---

## 2. Onboarding, Authentication & Security

*Source: CONTEXT.md §5 + Confirmed Decisions 2026-09-28. Status: **Confirmed**.*

```
Landing page (public)
  └─→ Guardian fills contact/application form
        └─→ Admin reviews application
              └─→ Admin approves
                    └─→ Admin provisions email + temporary password
                          └─→ Delivered to user (WhatsApp/fallback)
                                └─→ User logs in (rate-limited)
                                      └─→ must_change_password = true forces new password
                                            └─→ Access granted to role-based dashboard
```

- **Admin-Gated Provisioning:** No public self-registration. Admin creates initial accounts and sets an initial password.
- **Forced Password Change (`must_change_password`):** On first login, the user is required to set a new password before accessing any platform feature.
- **No Self-Service Password Reset in MVP:** If a user forgets their password, they contact Admin. Admin assigns a new temporary password and sets `must_change_password = true` again.
- **Login Rate Limiting:** Rate limiting on login attempts is required from Phase 1. Local implementation in dev, migrating to Redis when worker infrastructure is introduced.
- **Credential Delivery & Privacy:** WhatsApp (OpenWA) is the primary delivery channel, with **SMS** as the confirmed fallback channel if WhatsApp is unavailable or restricted. In `NotificationLog`, password values are **never stored** (record notification type, recipient, delivery status, and metadata only).

---

## 3. Sessions & Scheduling

*Source: CONTEXT.md §6 + Confirmed Decisions 2026-09-28.*

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

*Source: Confirmed Decisions 2026-09-28. Status: **Confirmed**.*

### Private Sessions (1:1)
1. Notification sent to student and teacher.
2. System enforces an **absence threshold = 25% of scheduled session duration** (e.g., 15 mins for 60-min session, 30 mins for 120-min session).
3. If student has not joined after 25% duration:
   - Student marked **Absent**.
   - Session marked **Cancelled/Missed**.
   - **Zero financial effect:** Teacher is not paid for a session that did not occur; student subscription quota is not deducted.

### Group Sessions (1:N)
- Attendance tracked individually per student.
- Only attending students are marked present and processed for quota deduction.
- Absent students are not deducted.
- Teacher submits one comprehensive session report.

### Teacher Attendance
- Teacher attendance is tracked via Zoom participant events.
- Actual duration is calculated after meeting ends.
- Informational late arrival alert sent if teacher joins >3 minutes late (no payroll penalty).
- **If teacher does not join: No payroll is generated.**

### Technical / Internet Outages & Replacement Sessions
- If a student or teacher suffers an outage preventing attendance, they report the reason to the Admin.
- Admin reviews the request.
- Upon approval, Admin schedules a **replacement session** linked to the original missed session (`replacement_for_session_id`).
- The original missed session has **0 effect** on student balance and teacher pay. The replacement session will handle balance deduction and payroll accrual when successfully completed and reported.

---

## 5. Automatic Payroll & Subscription Financial Model

*Source: CONTEXT.md §7 + Confirmed Decisions 2026-09-28. Status: **Confirmed** (HIGH RISK).*

### The Core Financial Invariant
> **Zoom attendance alone is NOT sufficient to generate teacher payroll or deduct student balance.**

For financial movement to execute:
1. Teacher attended the session via Zoom (duration calculated).
2. Teacher **submits the required post-session report**.
3. **Atomic Execution:** In a single database transaction:
   - Deduct per-session price from student via `SubscriptionLedger` (`SESSION_DEDUCTION`).
   - Credit teacher in `PayrollLedger` (`SESSION_CREDIT`).
   - If Admin forces resolution in dispute/exception, the same atomic movement applies.

```
Zoom meeting.ended
  │
  ├─► Teacher attended & duration calculated
  │
  └─► Teacher submits session report
        │
        ▼ (Single DB Transaction)
  ┌───────────────────────────────┐
  │ 1. SubscriptionLedger Debit   │
  │ 2. PayrollLedger Credit       │
  │ 3. Mark Session COMPLETED     │
  └───────────────────────────────┘
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
