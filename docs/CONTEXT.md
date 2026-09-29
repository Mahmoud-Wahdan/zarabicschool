# ZARABICSCHOOL (Madarak) — Project Context

> Purpose: stable project facts and decisions. This file is CONTEXT, not behavioral rules (those live in INSTRUCTIONS.md).
> Owner: Mahmoud Wahdan. Client: Zarabicschool Academy (owned/managed by a woman referred to as "the ZarabicSchool owner" — get her exact name/title before writing it into user-facing docs).
> Adopted source-of-truth scope document: the official "ZarabicSchool" project overview (24 sections, Arabic) — supersedes earlier informal notes where they conflict.
> Last revised: 2026-09-29 (synced with docs/specs/*, the owner's answers to the Gemini Q&A, the embedded-Zoom decision, and the 2nd revision: payroll is HOURLY and AUTOMATIC, the teacher report is for REVIEW only, SMS is post-MVP/maybe never, staged delivery; 3rd revision: the student side is session packages, teacher pay is hourly, billable time = teacher together with at least one student).
>
> **Labels used below:** CONFIRMED (owner decided) / PROPOSAL (suggested, not yet accepted) / OPEN (undecided, do not invent) / ASSUMPTION (must be verified).
> Section numbers are stable — INSTRUCTIONS.md references them. Do not renumber.

---

## 1. Business Context — why build vs. subscribe

A live, mature competitor product exists: **madarakeg.com** ("مدارك"), a working SaaS with real paying customers, starting at 500 EGP/month, doing a very similar job (scheduling across timezones, multi-currency collection, virtual classroom, auto payroll, WhatsApp integration, child safety).

**Decision (confirmed):** build anyway, not subscribe. Reasons stated by the owner/Lens Media:
1. Lens Media already runs full services for Zarabicschool (marketing, editing, content) — building the system is a natural extension, and "we're better positioned to earn this money" than paying a competitor.
2. Intent to eventually turn this into a full SaaS product sold to other academies (not just internal tooling for Zarabicschool) — Alaa and Zarabicschool's owner both know madarakeg.com exists and explicitly want to build their own instead.
3. The Zarabicschool owner tried madarakeg.com directly and rejected it for concrete reasons: found it too complex, its live-session tooling weaker than a plain Zoom call, and — critically — **its payroll pays teachers even when they don't show up to a session**, which she explicitly wants fixed here.

**Consequence:** because the long-term intent is a resellable SaaS, security/data-integrity discipline (Section 7 of INSTRUCTIONS.md) applies with *more* weight than a purely internal tool would warrant — a future paying customer's data will eventually sit on the same foundations being built now.

---

## 2. Domain & Source Material — verification status

- **Primary source of truth for scope:** the official ZarabicSchool project document (24 sections) — domain model, user journeys, MVP scope, and the 8 implementation phases are adopted from it.
- Brand guide PDF (Zarabicschool Logo System v1.0) — reviewed, see Section 3.
- `docs/specs/*` were generated with Gemini (Antigravity) from the owner's answers. Where a spec file says "Confirmed", it was checked against the owner's statements in Section 17's status table; items that could not be matched are marked "VERIFY WITH OWNER" there.

---

## 3. Brand / Design Reference

- **Name:** Zarabicschool — "تعلّم العربية والقرآن ... بنيَة تضيء قلبك" / "Learn Arabic & Quran... with a foundation that lights your heart"
- **Colors:** Navy Blue `#1B365D` (primary — trust/academic), Emerald Green `#00897B` (secondary/CTA — Islamic identity/growth), Warm Gold `#D4AF37` (accent — quality/premium). Suggested mix: 60% neutral, 30% Navy/Emerald, 10% Gold accent.
- **Typography:** Arabic — Cairo (headings) / Tajawal (body). English — Montserrat.
- **Logo:** combines Arabic letter ز (Z) and ع (A) inside a mihrab/dome-shaped frame. Full logo/variant files referenced in the brand PDF — use those assets directly rather than recreating them.
- Full brand guideline PDF is the source of truth for anything not summarized here (icon set, clear-space rules, application matrix).

---

## 4. Users & Roles — CONFIRMED

1. **Student** — views own data, schedule, upcoming/past sessions, join links, recordings (when available), attendance history, announcements.
2. **Guardian** — centralized view across all linked children: schedules, attendance, recordings, financial status, teacher-written progress reports, updates. Fills the contact/application form on the landing page.
3. **Teacher** — own schedule, assigned students, session join, past-session log, attendance view, financial/payroll info, writes per-student progress reports, **writes a mandatory post-session report**, receives student evaluations.
4. **Admin** — full control: applications/leads, all accounts, subjects/relationships, schedules, live sessions, attendance, recordings, finances, announcements, reports, replacement sessions, payroll payouts. Admin provisions all accounts.

**Relationship rules (CONFIRMED):**
- One guardian → many students.
- A student can be an **Adult** (independent, studies without a guardian) or a **Minor** (linked to exactly one guardian: father or mother).
- Teachers ↔ Subjects: many-to-many.
- Students/Admin may propose subject–teacher pairings; **Admin confirms** the final assignment.
- The public application form has separate tabs per user type (guardian, student, teacher) with role-specific fields (e.g. expected hourly rate for teachers; adult vs. minor guardian info for students).

---

## 5. Onboarding, Authentication & Security — CONFIRMED

**Public site → Application form (Guardian, Student, Teacher) → Admin reviews & validates → Admin approves → System automatically provisions account (email + generated temporary password) & dispatches credentials via WhatsApp (OpenWA) → User first login → `must_change_password` forces a new password → Role-based dashboard.**

- No public self-registration. No WhatsApp-based authentication (WhatsApp is notifications only — Section 8).
- **Auth = NextAuth/Auth.js only** (credentials provider, bcrypt hashing). No separate `JWT_SECRET`.
- **`must_change_password` = true** on account creation; enforced server-side, not only by redirect.
- **No self-service password reset in MVP.** Users contact Admin; Admin sets a new temporary password and `must_change_password = true` again.
- **Login rate limiting** from Phase 1 (in-memory locally; Redis when BullMQ infrastructure exists).
- `NotificationLog` never stores password values (type, recipient, status, metadata only).

**Credential delivery channel:**
- Primary: WhatsApp via OpenWA — CONFIRMED.
- Fallback when WhatsApp is down/banned: **SMS is post-MVP and may never be built** (CONFIRMED by owner 2026-09-29). 
- PROPOSAL for MVP fallback: Admin sees the temporary password once in the admin UI and delivers it manually by any channel (phone call, etc.). Because of forced password change, the temporary password is short-lived.
- OPEN: one-time activation link as a later improvement.

---

## 6. Live Sessions — Zoom

**Sessions are real Zoom meetings** (not LiveKit / not a custom video stack). The platform creates and tracks them through Zoom APIs.

### Confirmed integration model
- **Meeting creation:** when Admin schedules a session, the system creates the Zoom meeting via the **Zoom REST API** and registers the teacher and assigned student(s); each participant gets a unique join link stored against the platform entities. Mandatory registration is acceptable (CONFIRMED).
- **Events:** Zoom API + **WebSocket event subscription** (Server-to-Server OAuth app). Events: meeting started, participant joined/left, meeting ended. These are the source of truth for attendance. **No webhooks.**
- **User experience (owner decision 2026-09-29 — CONFIRMED as the target):**
  - **Desktop/web:** the Zoom meeting is hosted inside the platform's own page (Zoom Meeting SDK for Web, embedded).
  - **Mobile / fallback:** the user receives the join link and opens the native Zoom app.
  - **PLAN / risk control:** the join-link path is built first (needed anyway for mobile and as fallback). The embedded SDK view is implemented **last inside Phase 4** and may slip without blocking attendance/payroll. Technical details (SDK credentials, server-side signature, registrant token, mobile-browser support) are verified in the Phase 4 spike. *This reverses the earlier "no embedded video" note; the reason is the owner's product preference.*
- **Teacher post-session report = mandatory, for REVIEW only. It never gates payment** (CONFIRMED 2026-09-29). Payment is settled automatically from Zoom-verified attendance (Section 7). If Zoom itself fails, Admin resolves the session manually (audited); that manual path must not silently become the primary path.
- **ASSUMPTIONS to verify (Phase 4 spike):** the academy's Zoom plan supports Server-to-Server OAuth, meeting registration, WebSocket events, and the REST endpoints needed for reconciliation; how many meetings can run at the same time on the licensed account(s); REST rate limits when creating many recurring sessions; recording and attendance-data availability per plan.
- **OPEN:** Zoom plan and cost — Alaa has not yet been informed (owner is finishing research first; if no cheaper alternative exists, Zarabicschool's owner buys Zoom). **OPEN:** which Zoom account owns the app (events only arrive from the account that owns it).

### How the WebSocket connection works (constraints the design must respect)
- Access token via Server-to-Server OAuth (`account_credentials` grant), expires after about one hour → refresh required.
- Token is appended to the WebSocket URL at connect time; base URL (with `subscriptionId`) lives in an env var; the token is never stored.
- Heartbeat every 30 seconds.
- **Events that occur while the connection is closed are NOT delivered later.** Therefore automatic reconnect is mandatory, and a **reconciliation job** (Zoom REST API) is required so payroll never depends solely on a live connection.
- No webhook signature → every event is untrusted input: validate with Zod and enforce idempotency before crediting anything.

### Attendance rules — CONFIRMED
- **Private (1:1):** notify student and teacher. If the student has not joined after **25% of the scheduled duration** (15 min for a 60-min session), student = Absent, session = MISSED/Cancelled, **zero financial effect** (no deduction, no teacher pay).
- **Group (1:N):** attendance tracked per student; only attending students are marked present and each consumes 1 session of their package. Not every student has to join: the teacher is paid for the time she spent with **at least one** student. The teacher submits one session report.
- **Teacher:** tracked via Zoom participant events; actual duration computed after the meeting ends. **If the teacher does not join, nothing is computed.** Joining >3 minutes late sends an informational alert only — **no payroll penalty** (CONFIRMED).
- **Absences / outages / replacement sessions:** if the student (private) or the teacher does not attend, the session is MISSED with zero financial effect. The reason is coordinated by **Admin with the student side and the teacher as a normal human matter — the system is not part of that conversation** (owner 2026-09-29). Admin then schedules a **replacement session** linked to the original (`replacement_for_session_id`); the replacement settles when it is completed. Whether students/teachers also get an in-app outage-request form is OPEN (PROPOSAL: Admin-only replacement scheduling with a free-text reason for the MVP; the request form is Post-MVP).

### Session model — CONFIRMED
- Private (1:1) and group (1:N) sessions, configured by Admin.
- Admin defines **weekly recurring patterns** (e.g. Mon & Thu 18:00 for 8 weeks) instead of creating every session by hand.

### Notification chain (WhatsApp via OpenWA)
1. Session created → Teacher notified.
2. 2 hours before → reminder to teacher.
3. Teacher joins → students notified.
4. Teacher >3 min late → informational alert.
5. Student joins → Guardian notified (CONFIRMED that the guardian is told; recipients of the rest — see Section 7 OPEN).
6. **Meeting ends** → teacher notified to write the session report (mandatory, review only); student notified to write an evaluation of the teacher (**optional** — a late or missing evaluation has no consequence).
7. Teacher report late (owner: about 15 minutes) → second notification to the teacher.
8. Teacher still late after that → a **red mark** is recorded on the teacher (visible to Admin). PROPOSAL for the exact rule: T+0 notify, T+15 min reminder, T+30 min red mark; no payroll effect. The owner remembers a "red dot" idea from an earlier discussion that is not written in any file — confirm whether it also applies to late *joining*.
9. Optional low-balance warning when ~75% of purchased time is used (Post-MVP candidate).

---

## 7. Financial Model — teacher payroll & student balance (HIGH RISK — treat like a payment system)

### The core rule — CONFIRMED (3rd revision, 2026-09-29)
Two different units, on purpose:
- **Student side = subscription packages counted in SESSIONS.** A package (e.g. the 500 package = 8 sessions) gives the student N sessions to use over a month, two months or more, for **any subject and any teacher**. The guardian already knows how long a session is. Each session the student actually attends consumes exactly **1 session**, whatever its length. The student's money is handled by Invoices (Section 12), not by the ledger.
- **Teacher side = money by the hour**, from the actual time spent teaching (a fixed price per session would be unfair between a 1-hour and a 2-hour session). It is **independent of what the student paid** — the academy keeps the difference.

When a session ends, in ONE database transaction: (1) one `SESSION_DEDUCTION` (−1 session) **per attending student**, (2) **ONE** `SESSION_CREDIT` to the teacher = billable time × the teacher's hourly rate, (3) the session's settlement marker.

**Billable time (teacher) — CONFIRMED:** the time during which the **teacher AND at least one student** were in the meeting together (union of the overlaps). In a group session one student is enough. If nobody from the student side was ever with the teacher (private session with only the teacher, or group with zero students) → billable time = 0 → no pay, no deduction, session MISSED.

- The teacher's report does **not** gate payment (Section 6). *Supersedes earlier drafts: report-gated payroll, per-session price, minutes-based student balance.*
- **The teacher is paid for the time she worked even if the student's package is empty** — the student side must never make the settlement fail (see OPEN item 4).
- Teacher does not join → nothing is computed.

### Settlement marker & double-payment protection — CONFIRMED design (built in Phase 6)
`Sessions.financially_settled_at` (nullable timestamp) is set **inside the same transaction** that writes the ledger rows. Layers that stop a second withdrawal:
1. One transaction: ledger rows + marker commit or roll back together.
2. Claim step: `UPDATE sessions SET financially_settled_at = now() WHERE id = ? AND financially_settled_at IS NULL` — only the caller that changes exactly 1 row continues (or lock the row with `SELECT ... FOR UPDATE`).
3. Unique constraints on the ledgers themselves: **one `SESSION_CREDIT` per session** (PayrollLedger) and **one `SESSION_DEDUCTION` per (session, subscription)** (SubscriptionLedger). A duplicate insert fails and is treated as "already settled", not as an error.
4. Zoom event dedupe (`event_key` unique) so a repeated `meeting.ended` is ignored.
5. Queue job id = session id, so two settlement jobs for one session collapse into one.
The **ledgers are the truth; the marker is only an index**. Corrections (e.g. Zoom later reports a different duration) are made with `ADMIN_ADJUSTMENT`/`REFUND` entries — never by clearing the marker and never by editing settled data. The marker is not editable from any UI. A periodic consistency check must find "marker set but no ledger rows" and "ledger rows but no marker".

### Dual ledger — CONFIRMED
- **`SubscriptionLedger`** (student, counted in **sessions**): append-only; entry types `INITIAL_PURCHASE` (+N sessions when Admin confirms the invoice), `SESSION_DEDUCTION` (−1), `ADMIN_ADJUSTMENT`, `REFUND`. The remaining balance is computed from `sessions_delta` — no mutable counters. Money lives on Invoices; PROPOSAL: the ledger keeps no money amounts (or only informational ones).
- **`PayrollLedger`** (teacher, money per currency): append-only, never UPDATE/DELETE; `created_by = NULL` for system entries, NOT NULL for Admin actions; entry types `SESSION_CREDIT`, `ADMIN_ADJUSTMENT`, `DISBURSEMENT`. A `SESSION_CREDIT` stores what it was computed from: billable seconds, the hourly-rate snapshot, the Zoom event, source (LIVE_WEBSOCKET / RECONCILIATION / ADMIN).
- Idempotency at Zoom level: meeting-level `meeting_uuid:event_type`; participant-level `meeting_uuid:event_type:participant_uuid:event_time` (rejoins are valid).

### Multi-currency — CONFIRMED
ISO codes (`USD`, `EGP`), balances per currency, **no automatic conversion in MVP**. Admin converts manually and approves payouts (until a payment gateway with a wallet exists).

### Student payment stays manual — CONFIRMED
Section 12.

### Confirmed Business Rules (Updated 2026-09-29)
1. **Billable-Time Cap & Extension:** Capped by default at scheduled session duration. If a session exceeds scheduled time, the teacher writes the overtime in her post-session report, and Admin manually decides/approves any overtime credit via `ADMIN_ADJUSTMENT`.
2. **Rounding & Missing Exit Event:** Duration rounded per minute. If a participant has no leave event recorded in Zoom, close the interval at the meeting end timestamp.
3. **Teacher Hourly Rate:** Configured per teacher in agreement with the academy (`hourly_rate_minor` + `hourly_rate_currency` on `Teachers` profile table). Every `SESSION_CREDIT` in `PayrollLedger` records an immutable `hourly_rate_snapshot_minor` at settlement time for complete historical auditing.
4. **Student Session Consumption Threshold:** Student session is consumed if the student attended at least **25% of the scheduled session duration** (e.g. 15 min for 60-min session). If student leaves before 25%, session is marked missed/unattended by student.
5. **Prepaid Subscriptions:** Students/guardians pay upfront for a session package (e.g., 8 sessions). Admin verifies payment and credits the sessions. Sessions are deducted (−1) per completed class.
6. **Package Validity:** Packages have **no expiry date** (valid until used).
7. **Outage Report Form ("أبلغ عن عطل"):** Confirmed for **MVP** (students/teachers can submit technical outage reports directly from the platform for Admin review and replacement session scheduling).
8. **Public Application Flow for 3 Roles:** Landing page provides application forms for **3 distinct user roles** (Guardian, Student, Teacher). Admin receives, validates, and approves -> platform provisions credentials delivered via WhatsApp -> First login forces password change -> Role dashboard.
9. **Red Mark Rule:** Red marks are **only** recorded for late post-session reports (T+15 min reminder, T+30 min red mark). Joining late (>3 min) produces an **informational alert only**, with **NO red mark**.
10. **Hosting Decision:** VPS is the current architectural direction; final hosting confirmation will be made at deployment time after local development and testing are complete.

### OPEN sub-decisions (do not invent — ask when implementation reaches them)
1. **Reconciliation policy:** who verifies sessions missed during a prolonged disconnect, how often the automated reconciliation job runs, and edge handling when Zoom data is unavailable.
2. **Notification recipients:** fine details of WhatsApp notification recipients beyond the confirmed matrix.
3. **Evaluation-form fields:** exact questions/ratings in the student evaluation form (Phase 7).
4. **Zoom plan / concurrency:** final confirmation of Zoom plan tier and concurrency limits during Phase 4 spike.
5. **Zoom account ownership:** which Zoom account owns the Server-to-Server OAuth app.
6. **Worker process topology:** exact mono-repo / process management for web and background workers (Phase 1/4).

---

## 8. WhatsApp — role clarified

WhatsApp is used **only** for: credential delivery, registration/status updates, payment info, session reminders, attendance alerts, payroll alerts. It is **not** an authentication mechanism and **not** the source of truth for attendance.

**Provider: CONFIRMED — OpenWA** (self-hosted, unofficial, whatsapp-web.js based), because the official Cloud API could not be obtained.
- Auth: `X-API-Key` header. Sending number linked via QR-scanned session.
- Currently running locally without Docker; session connected.
- Must sit behind a `MessagingProvider` interface.
- **Risk:** unofficial → number can be banned. Use a dedicated number; never make WhatsApp the only channel for critical flows (see Section 5 fallback).

---

## 9. Reports & Evaluations — CONFIRMED MVP feature

- Teacher writes a free-text progress report per student.
- Teacher writes a **mandatory post-session report** after every meeting — for review; it does **not** affect payment (Sections 6–7).
- Student/Guardian can write a report/evaluation about a teacher.
- Automatic post-session evaluation form to the student about the teacher — **optional for the student** (fields = OPEN, Phase 7).
- Teacher lateness with the report is tracked (notifications + red mark, Section 6).

---

## 10. Technology Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, TypeScript, `next-intl` (Arabic primary + English, RTL first-class).
- **Backend/API:** Next.js (route handlers/server actions) for the web app, plus **separate long-running Node worker process(es)** for the Zoom WebSocket consumer, OpenWA client, and BullMQ workers. **OPEN:** exact repo/process structure (monorepo? shared Prisma package?) — to be presented as options in Phase 1/4.
- **Database/ORM:** PostgreSQL + Prisma on **Supabase** (transaction-mode pooler `DATABASE_URL` + `DIRECT_URL` for migrations) — CONFIRMED. Partial unique indexes, CHECK constraints and triggers are written as raw SQL inside Prisma migrations.
- **File storage:** payment proofs in a **private Supabase Storage bucket** (DB stores `file_path`; access via short-lived signed URLs) — CONFIRMED. Recordings: deferred (storage provider undecided; the schema draft mentions Cloudinary).
- **Video:** Zoom (Section 6).
- **Messaging:** OpenWA behind `MessagingProvider`. SMS provider: post-MVP, may never be built.
- **Background jobs:** BullMQ + Redis (reminders, absence-threshold timers, reconciliation).
- **Validation:** Zod. **Testing:** Jest + Supertest, React Testing Library, Playwright.

**Hosting:** a long-running Node process is required (cannot run serverless). The specs record **VPS** (Hetzner/DigitalOcean style) as confirmed on 2026-09-28. **VERIFY WITH OWNER:** the owner previously said the hosting decision waits until the app works locally. Treat VPS as the direction, final decision at the end of local development.

---

## 11. Tenancy & Scope — DECIDED

- **Single-tenant for Zarabicschool only in this build.** No multi-tenant middleware, no RLS now.
- Keep an `academy_id` column (single seeded UUID — not an env var) on tenant-owned tables so a later SaaS conversion doesn't require a data-model rewrite. Schema convention, not a security boundary in v1.
- *Future note:* if RLS is added later, set tenant context with `SET LOCAL` inside a transaction (session-level settings don't persist under transaction-mode pooling).
- **Explicitly out of MVP:** integrated payment gateways, multi-institution support, complex SaaS administration.

---

## 12. Payment Model (student-facing) — DECIDED

Fully manual for MVP: student/guardian submits payment proof (receipt image or transaction reference, stored in private Supabase Storage) → invoice `PENDING` → Admin verifies against the real bank/wallet → Admin confirms → invoice `PAID` → `SubscriptionLedger` gets an `INITIAL_PURCHASE` entry (+N sessions of the package). No Paymob/Stripe in MVP.

Money is integer minor units + ISO currency code everywhere.

---

## 13. Implementation Phases

1. **Foundation** — platform structure, login, accounts, permissions, basic dashboards.
2. **Educational management** — students, guardians, teachers, subjects, relationships, applications.
3. **Schedules & sessions** — schedule creation, recurring patterns, replacement sessions, session log.
4. **Live learning** — Zoom integration (Section 6).
5. **Attendance & recordings** — Zoom-event-driven attendance, teacher report (review) and its reminders, outage flow, recordings (deferred).
6. **Financial management** — manual payment confirmation (Section 12) + automatic hourly payroll settlement (Section 7).
7. **Admin & reports** — full admin dashboard, reports, evaluations, announcements.
8. **Testing & launch.**

Each phase has a living spec file under `docs/specs/` (INSTRUCTIONS.md Section 22).

---

## 14. Timeline — delivery in stages (owner 2026-09-29)

- **The client receives the system in stages**, not all at once (CONFIRMED). The stage boundaries and dates are OPEN. PROPOSAL: Stage 1 = Phases 1–3 (accounts, educational data, schedules); Stage 2 = Phases 4–5 (Zoom, attendance); Stage 3 = Phases 6–7 (money, reports); Phase 8 runs across all stages and closes the last one.
- Original client target: 1 to 1.5 months (4–6 weeks) for the whole thing — not realistic at part-time hours, hence the staged approach.
- **Effort estimate (PROPOSAL):** about **100–150 focused hours** for the MVP scope, with AI writing much of the code. At ~1–2 hours/day, 6 days/week (6–12 h/week) that is about **11–17 weeks**. The Phase 4 spike (Zoom plan, concurrency, embedded SDK) can change it.
- The staged plan and its dates still need to be agreed with Alaa/Zarabicschool before Phases 4–6 start.

---

## 15. Learning Path Integration — LIVE STATUS

1. ✅ JavaScript fundamentals/internals — completed
2. 🔶 Testing fundamentals + Jest — Jest done; React Testing Library in progress
3. ⬜ Git workflow/security → DSA → TypeScript → Advanced React/Node/Prisma deepening → Next.js full-stack → security/performance/accessibility/deployment

The project must not become an excuse to skip fundamentals. When a task needs an unmastered concept: explain it → show why the project needs it → let the owner attempt/reason → AI accelerates implementation → verification checkpoint.

---

## 16. Definition of Success

**Product:** Zarabicschool can run live classes (via Zoom), scheduling, Zoom-verified attendance, report-gated teacher payroll accrual, manual student billing, and the reports/evaluation loop — end to end, for real.

**Developer:** the owner can explain the Zoom event flow (WebSocket, reconnect, reconciliation), the payroll idempotency and transaction design, the auth/onboarding flow, the database schema's shape, and what AI generated vs. what he decided and why — for every non-trivial piece.

---

## 17. Integration decisions & environment (2026-09-29)

### Status table
| Topic | Status |
|---|---|
| Zoom meetings (REST API creation + registration) | CONFIRMED |
| Zoom experience: embedded on web + native app link on mobile | CONFIRMED as target; embedded part built last in Phase 4 |
| Zoom event delivery = WebSocket (no webhook) | CONFIRMED |
| WhatsApp = OpenWA (unofficial) behind `MessagingProvider` | CONFIRMED |
| Public Application Form for 3 Roles (Guardian, Student, Teacher) | CONFIRMED |
| Student subscription = prepaid package of N sessions; 1 session consumed per attended session (>=25% duration) | CONFIRMED |
| Package validity = No expiration date | CONFIRMED |
| Teacher payroll = automatic, by the hour, capped at scheduled time unless Admin approves overtime, one DB transaction | CONFIRMED |
| Billable time = teacher together with at least one student, rounded per minute | CONFIRMED |
| Missing exit event closes at meeting end | CONFIRMED |
| Teacher hourly rate = stored on teacher profile, snapshot captured in `PayrollLedger` on settlement | CONFIRMED |
| Outage request form ("أبلغ عن عطل") for students and teachers | CONFIRMED for MVP |
| Teacher report = mandatory for review, does NOT gate payment; late report (T+15m reminder, T+30m red mark) | CONFIRMED |
| Late joining >3 min = informational alert only (no red mark) | CONFIRMED |
| Student evaluation = optional | CONFIRMED |
| Dual append-only ledgers, multi-currency, manual conversion | CONFIRMED |
| Auth = NextAuth only, forced password change, no self-reset, login rate limit | CONFIRMED |
| Payment proofs in private Supabase Storage | CONFIRMED |
| Supabase as Postgres host | CONFIRMED |
| SMS fallback | Post-MVP, may never be built — CONFIRMED |
| Delivery to the client in stages | CONFIRMED (stage boundaries OPEN) |
| Hosting = VPS | Architectural direction; final confirmation at deployment time |
| Reconciliation policy for missed Zoom events | OPEN |
| Notification recipients (beyond the confirmed ones) | OPEN |
| Zoom plan / cost / concurrent-meeting capacity (Alaa not yet informed) | OPEN |
| Which Zoom account owns the Server-to-Server OAuth app | OPEN |
| Repo/process structure for web + workers | OPEN |

### Process model
A long-running Node process is required (Zoom WebSocket + OpenWA + BullMQ). Exact structure is open (see Section 10).

### Environment variable names (names only — never values in docs or Git)
`DATABASE_URL`, `DIRECT_URL`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBSOCKET_URL`, `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `NEXTAUTH_SECRET`.
- `ZOOM_WEBSOCKET_URL` holds the base URL with `subscriptionId` only; the access token is generated at runtime.
- Removed: `JWT_SECRET` (auth is NextAuth only), `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `ZOOM_WEBHOOK_SECRET_TOKEN`.
- To be added when their phase starts (names to confirm then): Zoom Meeting SDK credentials (Phase 4 spike), Redis connection (BullMQ), Supabase Storage credentials (Phase 6).
- `.env` is never committed; `.env.example` contains names only.
- **Action:** secrets exposed during setup (database password, Zoom client secret, auth secret) must be rotated before any real data is stored (tracked in PROGRESS.md).

---

## 18. MVP cut line & Post-MVP backlog (working agreement 2026-09-29)

We are building the **MVP only**. Anything that would take disproportionate time is **documented in the phase spec files under a "Deferred / Post-MVP" section and implemented only when its time comes** — never silently dropped, never silently built early.

- **DEFERRED (owner-stated):** SMS fallback channel — post-MVP and may never be built.
- **PLANNED BUT BUILT LAST / MAY SLIP (owner-stated):** embedded Zoom view on web (Phase 4).
- **CANDIDATES to defer (PROPOSAL — owner decides):** low-balance alert; the post-session student evaluation prompt (it is optional anyway); recordings access; announcements; recurring-schedule editing tools beyond generation; activation-link credential flow; reconciliation reporting UI.
- Everything in Section 11's "explicitly out of MVP" list stays out.
