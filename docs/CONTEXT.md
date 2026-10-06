# ZARABICSCHOOL (Madarak) — Project Context

> Purpose: stable project facts and decisions. This file is CONTEXT, not behavioral rules (those live in INSTRUCTIONS.md).
> Owner: Mahmoud Wahdan. Client: Zarabicschool Academy (owned/managed by a woman referred to as "the ZarabicSchool owner" — get her exact name/title before writing it into user-facing docs).
> Adopted source-of-truth scope document: the official "ZarabicSchool" project overview (24 sections, Arabic) — supersedes earlier informal notes where they conflict.
> Last revised: 2026-10-06 — **7th revision (FINAL context before the docs sweep)**: decisions from the owner's MCQ rounds — Admin/Supervisor APPROVAL of the report triggers pay; Supervisor = Admin without money and without managing admins; Paymob (EGP) + a USD gateway; monthly 8-session plan with no rollover + pay-per-session credits; monthly payout; DB-polling scheduler; no mock data (schema first, full seed, UI on real data). Earlier — **6th revision**: payment gateway + automatic recurring billing in USD (Section 20), Supervisor role (Section 4), OpenWA credential delivery starts now (Section 5), dashboards UI/UX plan (Section 21), documented conflict on who approves reports (Section 7). Earlier — **5th revision (2026-09-29)**: NO Zoom API (Admin creates meetings in Zoom and pastes the link), teacher pay is triggered by the teacher's REPORT, no recordings, no embedded Zoom, prepaid session packages, hourly teacher pay, staged delivery; plus per-student reports, report visibility, no trial sessions, and the post-delivery SaaS roadmap (Section 19). The 5th-revision submission-triggered pay wording is obsolete.
>
> **Labels:** CONFIRMED (owner decided) / PROPOSAL (suggested, not yet accepted) / OPEN (undecided, do not invent) / ASSUMPTION (must be verified).
> Section numbers are stable — INSTRUCTIONS.md references them. Do not renumber.
> **Current work mode:** only documentation is being changed. No code is written until the owner says "start implementation".

---

## 1. Business Context — why build vs. subscribe

A live, mature competitor product exists: **madarakeg.com** ("مدارك"), a working SaaS with real paying customers, starting at 500 EGP/month, doing a very similar job (scheduling across timezones, multi-currency collection, virtual classroom, auto payroll, WhatsApp integration, child safety).

**Decision (confirmed):** build anyway, not subscribe. Reasons stated by the owner/Lens Media:
1. Lens Media already runs full services for Zarabicschool (marketing, editing, content) — building the system is a natural extension, and "we're better positioned to earn this money" than paying a competitor.
2. Intent to eventually turn this into a full SaaS product sold to other academies — Alaa and Zarabicschool's owner both know madarakeg.com exists and explicitly want to build their own instead.
3. The Zarabicschool owner tried madarakeg.com and rejected it: too complex, its live-session tooling weaker than a plain Zoom call, and — critically — **its payroll pays teachers even when they don't show up to a session**, which she wants fixed here. *(See Section 6, "Trust model": with manual Zoom links this is addressed by report-gated pay + Admin review, not by automatic verification.)*

**Consequence:** because the long-term intent is a resellable SaaS, security/data-integrity discipline (Section 7 of INSTRUCTIONS.md) applies with *more* weight than a purely internal tool would.

---

## 2. Domain & Source Material

- **Primary source of truth for scope:** the official ZarabicSchool project document (24 sections).
- Brand guide PDF (Zarabicschool Logo System v1.0) — see Section 3.
- `docs/specs/*` were generated with Gemini (Antigravity) from the owner's answers and are being revised to match this file.
- **UI reference:** four screenshots of a similar product's teacher app (owner, 2026-09-29) — see Section 6, "Teacher experience". They are a UX reference only; do not copy branding.

---

## 3. Brand / Design Reference

- **Name:** Zarabicschool — "تعلّم العربية والقرآن ... بنيَة تضيء قلبك" / "Learn Arabic & Quran... with a foundation that lights your heart"
- **Colors:** Navy Blue `#1B365D` (primary), Emerald Green `#00897B` (secondary/CTA), Warm Gold `#D4AF37` (accent). Suggested mix: 60% neutral, 30% Navy/Emerald, 10% Gold.
- **Typography:** Arabic — Cairo (headings) / Tajawal (body). English — Montserrat.
- **Logo:** Arabic letters ز (Z) and ع (A) inside a mihrab/dome-shaped frame. Use the files from the brand PDF; do not recreate them.

---

## 4. Users & Roles — CONFIRMED

1. **Student** — own data, schedule, upcoming/past sessions, Zoom link per session, attendance history, homework (OPEN: whether the student sees the homework part of the teacher's report — the teacher's report itself goes to the guardian and Admin), announcements.
2. **Guardian** — centralized view across all linked children: schedules, attendance, financial status (remaining sessions), teacher-written progress reports, updates. Can also apply through the guardian application form.
3. **Teacher** — own schedule, assigned students, a button beside each student's session that opens Zoom, a report form per session/student, and a dashboard with her sessions and her salary (Section 6, "Teacher experience").
4. **Admin (SuperAdmin)** — full control, including all money: applications, all accounts, subjects/relationships, schedules and **Zoom links**, reports review, outage requests, replacement sessions, finances, payroll adjustments and payouts, announcements. Admin provisions all accounts. A student sees the **homework, notes and attachments** of the teacher's reports (an adult student without a guardian sees the whole report); see Section 9.
5. **Supervisor (مشرف)** — role CONFIRMED (owner, 2026-10-06): **can do everything the Admin can, except money and managing Admins/Supervisors.** Concretely: applications (review/approve → account creation), accounts and profiles, subjects/relationships, schedules and Zoom links, approving/rejecting teacher reports, outage requests, replacement sessions, complaints, announcements, and audited scheduling overrides. NOT allowed: invoices/payments/gateway/plans/prices/exchange rate, payroll, adjustments, overtime approval, reversals, disbursements, refunds, creating/deactivating Admins or Supervisors, system settings. Note: approving a report is what releases the teacher's pay, but the system writes the ledger and the Supervisor never sees or edits amounts. Enforcement is **server-side** through one permission map. Schema: `UserRole` gains `SUPERVISOR`; PROPOSAL: rename `ADMIN` → `SUPER_ADMIN` while migrations are disposable.

**Relationship rules (CONFIRMED):**
- One guardian → many students. One student → exactly one guardian.
- Teachers ↔ Subjects: many-to-many. Students/Admin may propose pairings; **Admin confirms**.
- **Three application forms** (guardian, student, teacher), each with its own fields (exact fields = OPEN). A student application must identify the guardian (name, phone, relationship) so Admin can link an existing guardian or create one first (PROPOSAL).

---

## 5. Onboarding, Authentication & Security — CONFIRMED (one open sub-question)

**Landing page → application form (guardian / student / teacher) → Admin receives → Admin validates (REVIEWED) → Admin accepts (APPROVED) → each accepted user receives their own username + temporary password → first login → `must_change_password` forces a new password → role-based dashboard.**

- **Login identifier:** the flow says "username and password". PROPOSAL: login by a unique **username**; email optional. OPEN — confirm.
- No public self-registration. WhatsApp is notifications only, never authentication.
- **Auth = NextAuth/Auth.js only** (credentials, bcrypt). No `JWT_SECRET`.
- `must_change_password` enforced **server-side**, not only by redirect.
- **No self-service password reset in MVP.** Admin sets a new temporary password and `must_change_password = true` again.
- **Login rate limiting** from Phase 1 (in-memory locally; a shared store later).
- `NotificationLog` never stores password values.

**Credential delivery:** primary WhatsApp via OpenWA — CONFIRMED. **Implementation starts now (owner, 2026-10-06):** replace the fake provider with an `OpenWAProvider` behind `MessagingProvider`, selected by configuration; the approval route must call the provider through that interface, not import the fake directly; the password goes only into the outgoing message and never into logs or `NotificationLog`; a failed send must not roll back the approval and must leave a redacted failure row so Admin can retry; the Admin one-time credentials panel stays as the fallback. **SMS is post-MVP and may never be built** (CONFIRMED). PROPOSAL for the MVP fallback: Admin sees the temporary password once in the admin UI and delivers it manually.

---

## 6. Live Sessions — Zoom via manual links (owner, 2026-09-29 — CONFIRMED)

### The model
- **No Zoom API of any kind.** No Server-to-Server OAuth, no WebSocket events, no meeting registration, no REST reports, no reconciliation. **No embedded Zoom interface** and **no recordings / replay** (unlike madarakeg.com).
- **Admin creates the meetings/sessions inside Zoom itself** (Zoom app or web) and **adds the Zoom link to the session in the platform**. Recurring weekly patterns: PROPOSAL — the same link is copied to every generated session, editable per session.
- Teacher and students see the session in their dashboard with a **button beside the student's name/session that opens Zoom directly**; when they finish they come back to the platform.
- Same button works on desktop and mobile.
- ASSUMPTIONS to sort out in practice (not code): how the teacher starts a meeting Admin created (alternative host / host link — the platform stores one join link, plus an optional host link if needed); how many simultaneous meetings the academy's Zoom account allows. The Zoom plan/cost conversation with Alaa is still pending.

### Consequence: attendance is no longer machine-verified
The platform cannot know who actually joined. **"The session happened and the student attended" = what the teacher states in her report.** This replaces the earlier Zoom-event design (WebSocket consumer, event keys, attendance segments, reconciliation) — all removed from the MVP.

### Trust model — safeguards (PROPOSAL, owner to confirm)
Pay depends on the teacher's word, so the design adds cheap controls instead of Zoom verification:
1. A report can be submitted only by the assigned teacher, only for a session in her schedule, only **after the scheduled end time** (server-side check), and only once per (session, student).
2. Money is written only inside the report-**approval** transaction (Section 7); fields that affect money cannot be edited after submission.
3. Admin/Supervisor approval queue: nothing is paid until a report is approved; anything wrong afterwards is reversed with adjustment/refund ledger entries (never by editing history).
4. Students/guardians see attendance per session on their dashboards (natural cross-check). A "dispute" button is a Post-MVP candidate.
5. The Zoom button goes through a small platform redirect that logs "user X opened the link for session Y at time T" — soft evidence for Admin, not proof (PROPOSAL, tiny).
6. Later option (Post-MVP, only if the client wants proof): add a Zoom API verification layer on top; the ledger design does not change.

### Teacher experience (from the reference screenshots)
- **Dashboard:** total sessions/hours assigned, done, remaining, attended percentage, and **her salary so far, rising with each APPROVED report (pending-approval amount shown separately — PROPOSAL)**; fines/bonus appear as adjustments; an "estimated month salary" widget is optional (owner to say which widgets he wants).
- **Today's classes:** list of student rows (student name, date/time, subject, duration, status such as Attended / Waiting / Pending); a "View" action; the Zoom button beside the student.
- **Report icon** appears **only after the session ends** (PROPOSAL: once the scheduled end time has passed). It opens the **"End class" form**: Class Remark (required dropdown), Summary (required), Homework (required), Notes, Upload files (image / PDF / other). Options of the dropdown = OPEN.
- Mobile-first layout.

### Session model — CONFIRMED
- Private (1:1) and group (1:N), configured by Admin. Weekly recurring patterns instead of creating every session by hand.
- **Absences / outages / replacement sessions:** if a session does not take place, the teacher reports it (student absent, etc.) and no money moves. **Student or teacher can submit an outage/absence request through an in-app form (MVP)** → Admin queue. Admin coordinates the reason with the student side and the teacher as a human matter; the system does not relay it. Admin schedules a **replacement session** linked to the original (`replacement_for_session_id`).
- Removed with the Zoom events: the 25%-of-duration absence timer, late-join detection, "teacher joined / student joined" alerts. (The teacher marks the outcome in the report.)

### Notification chain (WhatsApp via OpenWA)
1. Session created → teacher notified.
2. About 2 hours before → WhatsApp reminder to the **teacher, the student and the guardian** (CONFIRMED).
3. Scheduled end passed → teacher asked to write the report (mandatory; its approval by Admin/Supervisor triggers her pay); student asked to write an evaluation (**optional**).
4. Report still missing ~15 minutes later → second notification.
5. Still missing after that → **red mark** on the teacher, visible to Admin — for a late **report** only. PROPOSAL: T+0 notify, T+15 reminder, T+30 red mark. Timing measured from the scheduled end.
6. Optional low-balance warning when ~75% of the package is used (Post-MVP candidate).

---

## 7. Financial Model — teacher pay & student credits (HIGH RISK — treat like a payment system)

### The core rule — CONFIRMED (7th revision, 2026-10-06)
Two units, on purpose:
- **Student = prepaid session credits** (counted in sessions). Student money lives on Invoices (Sections 12 and 20).
- **Teacher = money by the hour**, independent of what the student paid. The hourly rate is agreed between the academy and each teacher and entered by Admin.

**Money moves only after Admin or Supervisor APPROVES the teacher's per-student report. Submitting the report moves nothing.** (Supersedes the 5th-revision "submission triggers pay". This matches PROGRESS.md and the phase-05/06 specs.)

**Report lifecycle:** `SUBMITTED → APPROVED → ARCHIVED` (archival happens in the settlement transaction), or `SUBMITTED → REJECTED → SUBMITTED` after the teacher corrects. The same `Reports` row is edited before archive; there is no revision/version table. Reports are per student, also in group sessions.

**Approval transaction — ONE database transaction, when the report says the student ATTENDED:**
1. one `SESSION_DEDUCTION` (−1 session) on that student's credits;
2. one `SESSION_CREDIT` to the teacher = **scheduled duration × her hourly rate**, created once per session by the first approved attended report (rate = the `TeacherRates` row whose `effective_from` ≤ the session's scheduled start; the credit stores the minutes and a rate snapshot);
3. attendance is written to `SessionStudents`, and `Reports.settled_at` + `archived_at` are set.
If the report says the student did not attend, that student's attendance becomes `STUDENT_ABSENT` and neither that student nor the teacher receives a financial entry. The session itself is marked `MISSED` only when the session did not take place; a group session can therefore be completed while some students are absent.

**Who may do what with money:**
- **Admin and Supervisor** may approve/reject reports. The system itself writes the ledger rows. A Supervisor never sees or edits amounts (server-enforced, not only hidden in the UI).
- **Admin only** (PROPOSAL, consistent with "Supervisor has no money access"): overtime approval, payroll adjustments, reversals of a wrongly settled report, monthly payroll close and disbursements, refunds, exchange rate, plan prices.

### Student credits — CONFIRMED (2026-10-06)
- **Monthly plans:** Admin defines plans; the base plan is **8 sessions per month**, and other tiers can exist. Charged automatically every month (Section 20). Each period grants N sessions; **unused sessions do NOT roll over** — they expire at the end of the period.
- **"على كيفك" (pay per session):** the payer chooses any number of sessions and pays the per-session price × count. These credits **never expire**. (Min/max count: OPEN.)
- Credits work for any subject and any teacher.
- **Consumption order** (PROPOSAL): earliest-expiring credits first; pay-per-session credits last.
- **Prices:** Admin sets prices in ONE currency; the system converts to the other using an exchange rate set by Admin. Every invoice stores the rate used (snapshot). Changing the rate affects future invoices only; the payer is notified before a renewal whose price changed.
- **Scheduling:** blocked when the student's remaining sessions run out (scheduled-but-unsettled sessions count against the balance). Admin **or Supervisor** may override; the override is audited with a reason.
- If a balance still goes negative at settlement, settle anyway and flag Admin. **The teacher's pay is never blocked or reduced by the student's package or payment state.**
- Failed renewal: grace period, then only NEW scheduling is blocked (Section 20.6).

### Teacher pay details — CONFIRMED
- Pay basis = the scheduled duration (time is not measured). **Overtime:** the teacher says so in her report; Admin decides; approved extra time is paid as an `ADMIN_ADJUSTMENT`, never by re-settling.
- **Payout cycle = monthly:** at month end Admin closes the payroll and records the payment (`DISBURSEMENT`) per currency.
- Teacher balances are kept per currency (ISO `USD`, `EGP`); **no automatic conversion** — Admin converts manually.
- Rate storage = effective-dated `TeacherRates` table (`id, teacher_id, hourly_rate_minor, currency, effective_from, created_by`), built in Phase 6.

### Double-payment protection — CONFIRMED design (built in Phase 6)
1. One transaction: ledger rows + report markers commit or roll back together.
2. **One report per (session, student)** — unique constraint.
3. Unique constraints on the ledgers: one `SESSION_CREDIT` per session; one `SESSION_DEDUCTION` per (session, subscription). A duplicate insert (or a second approval click/retry) = "already settled", not an error.
4. Money-affecting fields (attendance outcome, claimed extra time) are frozen once the report is submitted; after approval the row is archived and immutable.
5. Server-side checks: assigned teacher, after scheduled end, session not cancelled, approver is Admin/Supervisor.
6. Corrections only by `ADMIN_ADJUSTMENT` / `REFUND` / reversal entries — never by editing or deleting history.

### Dual ledger — CONFIRMED
- **`SubscriptionLedger`** (student, counted in sessions): append-only; `INITIAL_PURCHASE` (+N on every confirmed paid invoice, including renewals), `SESSION_DEDUCTION` (−1), `EXPIRY` (NEW — written by the worker at period end for unused monthly sessions), `ADMIN_ADJUSTMENT`, `REFUND`. Balance = sum of `sessions_delta`; no mutable counters. Monthly grants carry an expiry date (PROPOSAL).
- **`PayrollLedger`** (teacher, money per currency): append-only, never UPDATE/DELETE; `created_by = NULL` for system entries, NOT NULL for Admin; `SESSION_CREDIT`, `ADMIN_ADJUSTMENT` (fines, bonus, overtime), `DISBURSEMENT`. Each credit stores the report that triggered it, the minutes credited and the hourly-rate snapshot.

### OPEN sub-decisions (do not invent — ask when implementation reaches them)
1. Rounding of hourly amounts to integer minor units.
2. Min/max sessions for "على كيفك".
3. Number of grace days (owner said "e.g. 3" — default 3, configurable).
4. When the report becomes available to the teacher (PROPOSAL: after the scheduled end; Admin can unlock).
5. Late-report timing (PROPOSAL: T+0 notify, T+15 reminder, T+30 red mark, measured from the scheduled end).
6. Whether the teacher sees "pending approval" earnings separately from approved earnings (PROPOSAL: yes).
7. Evaluation-form fields (Phase 7) and whether the student's evaluation is mandatory (currently optional).
8. How a wrongly settled report is reversed (PROPOSAL: one Admin action writing the reversing entries).

*Resolved:* prepaid credits; hourly pay independent of price; approval (Admin/Supervisor) triggers the pay; reports per student also in groups, the teacher's credit once per session; overtime decided by Admin; outage/absence form in the MVP; red mark for late reports only; no trial-session type; no Zoom API / recordings / embedded interface; monthly payout; scheduling blocked at zero with audited override; class-remark list; attachments rule (Section 9).

---

## 8. WhatsApp — role clarified

WhatsApp is used **only** for: credential delivery, registration/status updates, payment info (receipts, renewal reminders, failed-renewal notices), session reminders (teacher + student + guardian), report notices (the guardian is messaged automatically when a report is approved — CONFIRMED), payroll-related alerts. It is not authentication and not a source of truth.

**Provider: CONFIRMED — OpenWA** (self-hosted, unofficial, whatsapp-web.js based), because the official Cloud API could not be obtained.
- Auth: `X-API-Key` header; sending number linked via a QR-scanned session.
- Currently running locally without Docker; session connected.
- Behind a `MessagingProvider` interface.
- **Risk:** unofficial → number can be banned. Dedicated number; never the only channel for critical flows.

---

## 9. Reports & Evaluations — CONFIRMED MVP feature

- **Teacher session report (mandatory; its approval by Admin/Supervisor triggers her pay):** class remark, summary, homework, notes, optional attachments (Section 6). Written **per student**, also in group sessions (CONFIRMED). **Fields:** class remark (list: excellent / good / acceptable / needs follow-up — editable by Admin in settings), summary (what was covered and how the student did), homework, notes, attachments (**images and PDF only, max 10 MB each, private storage**). **Visibility:** guardian, Admin and Supervisor see the whole report; the **student sees the homework, the notes and the attachments** (an adult student without a guardian sees the whole report). Whether the student also sees the class remark and the summary is PROPOSAL: no.
- Teacher free-text progress report per student (longer-term) — may be the same report stream; confirm in Phase 7.
- Student/Guardian can write a report/evaluation about a teacher — **visible to Admin only** (CONFIRMED).
- Automatic post-session evaluation form to the student — **optional**, no consequence if late or missing (fields = OPEN, Phase 7).
- Teacher lateness with the report is tracked (notifications + red mark).

---

## 10. Technology Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, TypeScript, `next-intl` (Arabic primary + English, RTL first-class).
- **Backend/API:** Next.js route handlers / server actions.
- **Background work:** timed notifications (2h reminder, report reminders, red mark) and the OpenWA sender need something running continuously. OpenWA itself is a self-hosted service that must stay up. **CONFIRMED (2026-10-06): a simple database-polling worker** (checks a jobs table every minute; no Redis/BullMQ in the MVP). It runs reminders, report notices, red marks, monthly-credit expiry and subscription renewals.
- **Database/ORM:** PostgreSQL + Prisma on **Supabase** (transaction-mode pooler `DATABASE_URL` + `DIRECT_URL` for migrations) — CONFIRMED. Partial unique indexes, CHECK constraints and triggers are raw SQL inside Prisma migrations.
- **File storage:** private **Supabase Storage** buckets (payment proofs and report attachments); DB stores `file_path`; access via short-lived signed URLs.
- **Video:** Zoom used from outside the platform via links (Section 6). No Zoom SDK, no Zoom API client.
- **Messaging:** OpenWA behind `MessagingProvider`. SMS: post-MVP, may never be built.
- **Payments (NEW):** hosted-checkout gateways behind a `PaymentProvider` interface: **Paymob (EGP)** + a USD gateway (provider OPEN, Section 20.3). No card data on our servers.
- **Validation:** Zod. **Testing:** Jest + Supertest, React Testing Library, Playwright.
- **Hosting:** decided at deployment time (owner, 2026-09-29). Working assumption: a small VPS for the web app and the always-on pieces.

---

## 11. Tenancy & Scope — DECIDED

- **Single-tenant for Zarabicschool only.** No multi-tenant middleware, no RLS now.
- Keep an `academy_id` column (single seeded academy row, not an env var) on tenant-owned tables for a later SaaS conversion. Schema convention, not a security boundary in v1.
- *Future note:* if RLS is added later, set tenant context with `SET LOCAL` inside a transaction (transaction-mode pooling).
- **Explicitly out of MVP:** multi-institution support, complex SaaS administration. (Payment gateway moved INTO scope by the owner on 2026-10-06 — Section 20.) (The post-delivery SaaS plan is in Section 19.)

---

## 12. Payment Model (student-facing) — DECIDED (7th revision)

Online payment through payment gateways, with automatic monthly renewal (full design in Section 20).
- The payer (the guardian, or an adult student without a guardian) **chooses the currency at checkout: EGP → Paymob; USD → a second gateway** (provider OPEN, Section 20.3).
- The money reaches the academy in the currency that was paid (owner's requirement; whether each provider really settles that way must be verified — Section 20.3).
- Flow: Invoice `PENDING` → hosted checkout → provider webhook (signature verified) → Invoice `PAID` → `SubscriptionLedger` `INITIAL_PURCHASE` (+N sessions). Money is integer minor units + ISO currency everywhere.
- **Manual proof upload (receipt image/transaction reference → Admin confirms)** was the old flow. PROPOSAL: keep it only as a fallback that reuses the same Invoice states; it is not a priority.
- **The academy bears all costs** (gateway fees, refunds, chargebacks) — the price shown to the payer has no fee added.

---

## 13. Implementation Phases

**Rule (owner, 2026-10-06): no mock data anywhere in the project.** First the FULL database schema for all phases, then a seed that covers everything, then every screen is built and tested against the real seeded database.

0. **Full database (NEW, first)** — all tables/enums of every phase in Prisma, raw-SQL invariants (partial unique indexes, CHECKs, append-only triggers, `ON DELETE RESTRICT`), a production-safe base seed (academy + admin) and a complete demo seed (all roles, plans, invoices, sessions, reports, ledgers, flags, requests, announcements), plus `db:verify`. Must include the new tables of Section 20 and the `SUPERVISOR` role.
1. **Foundation** — platform structure, login, accounts, permissions (Admin/Supervisor/Teacher/Student/Guardian), basic dashboards. OpenWA credential delivery (Section 5) belongs here.
2. **Educational management** — students, guardians, teachers, subjects, relationships, the three applications and their approval/provisioning, Admin CRUD.
3. **Schedules & sessions** — schedule creation, recurring patterns, Zoom link per session, replacement sessions, session log, scheduling block at zero credits with audited override.
4. **Live sessions via Zoom links** — the Zoom button (with the small logging redirect), link management, teacher/student session lists. A small phase.
5. **Session reports & attendance** (the spec file name still says "recordings"; there is no recordings feature) — report form with attachments, **Admin/Supervisor approval queue**, attendance from approved reports, notifications and red mark, outage/absence requests, overtime claims.
6. **Financial management** — plans, invoices, ledgers, **approval-triggered hourly settlement (Section 7)**, monthly payroll close and disbursements, exchange rate.
   - **6b. Online payments & automatic renewal (Section 20)** — Paymob (EGP) + USD gateway behind `PaymentProvider`, webhooks, renewal worker, failed-renewal grace.
7. **Admin & reports** — admin/supervisor dashboards, review queues, evaluations, announcements, complaints.
8. **Testing & launch.**

**Dashboards UI/UX (Section 21)** is a cross-cutting track: it starts right after Phase 0 and each role's screens are built on the seeded real data, in parallel with the backend phases.

Each phase has a living spec file under `docs/specs/` (INSTRUCTIONS.md Section 22).

---

## 14. Timeline — delivery in stages (owner, 2026-09-29)

- **The client receives the system in stages** (CONFIRMED). Stage boundaries and dates are OPEN. PROPOSAL: Stage 1 = Phases 1–3; Stage 2 = Phases 4–5; Stage 3 = Phases 6–7; Phase 8 spans all.
- **Effort estimate (PROPOSAL, after removing the Zoom API/WebSocket/reconciliation, embedded Zoom and recordings):** about **70–110 focused hours** with AI writing much of the code. At 6–12 h/week that is about **9–14 weeks**. The original client target of 4–6 weeks needs roughly 20–30 h/week.
- The staged plan and dates still need to be agreed with Alaa/Zarabicschool. The gateway/renewal work (6b), the Supervisor role and the full schema-first step add roughly 25–40 focused hours to the estimate above (PROPOSAL, not agreed).

---

## 15. Learning Path Integration — LIVE STATUS

1. ✅ JavaScript fundamentals/internals — completed
2. 🔶 Testing fundamentals + Jest — Jest done; React Testing Library in progress
3. ⬜ Git workflow/security → DSA → TypeScript → Advanced React/Node/Prisma deepening → Next.js full-stack → security/performance/accessibility/deployment

The project must not become an excuse to skip fundamentals. When a task needs an unmastered concept: explain it → show why the project needs it → let the owner attempt/reason → AI accelerates implementation → verification checkpoint.

---

## 16. Definition of Success

**Product:** Zarabicschool can run live classes (through Zoom links), scheduling, report-based attendance, approval-triggered hourly teacher pay, prepaid student packages with manual billing, and the reports/evaluation loop — end to end, for real.

**Developer:** the owner can explain the report-to-payment transaction and its double-payment protections, the auth/onboarding flow, the database schema's shape, and what AI generated vs. what he decided and why — for every non-trivial piece.

---

## 17. Decisions & environment (2026-09-29)

### Status table
| Topic | Status |
|---|---|
| Zoom = manual links pasted by Admin; **no Zoom API, no WebSocket, no embedded interface, no recordings** | CONFIRMED |
| Attendance / "session happened" = the teacher's report | CONFIRMED (safeguards in Section 6 are PROPOSAL) |
| Teacher salary rises only when she submits the report on the student | CONFIRMED |
| Teacher pay = hourly × scheduled duration; overtime decided by Admin from the report | CONFIRMED |
| Student subscription = prepaid package of N sessions, any subject/teacher, never expires | CONFIRMED |
| Dual append-only ledgers, multi-currency, manual conversion | CONFIRMED |
| Outage/absence request form in MVP; Admin coordinates humanly | CONFIRMED |
| Red mark = late session report only | CONFIRMED; timing PROPOSAL |
| Student evaluation optional | CONFIRMED |
| WhatsApp = OpenWA behind `MessagingProvider` | CONFIRMED |
| SMS fallback | Post-MVP, may never be built — CONFIRMED |
| Three application forms and their flow | CONFIRMED (fields OPEN) |
| Auth = NextAuth only, forced password change, no self-reset, login rate limit | CONFIRMED |
| Supabase (Postgres + private Storage) | CONFIRMED |
| Delivery to the client in stages | CONFIRMED (boundaries OPEN) |
| Hosting | OPEN until deployment |
| Scheduler for timed jobs = database-polling worker (no Redis) | CONFIRMED (2026-10-06) |
| Reports per student (also in groups); teacher report visible to guardian + Admin; student evaluation visible to Admin only; no trial sessions | CONFIRMED |
| Report availability timing | PROPOSAL (after scheduled end) |
| SaaS conversion after the Zarabicschool delivery | CONFIRMED as a plan (Section 19); nothing built now |
| Teacher hourly rate storage (table recommended) | OPEN — owner to choose |
| Login identifier: username vs email | OPEN — PROPOSAL: username |
| Zoom account cost / capacity (Alaa not yet informed) | OPEN |
| Payment gateway added; student payments in USD; automatic monthly/yearly renewal | CONFIRMED (owner, 2026-10-06) |
| Academy bears all fees, refunds, chargebacks and platform subscriptions | CONFIRMED by owner (agreed with Alaa; get it in writing) |
| Paymob for EGP (owner delegated the choice); second gateway for USD | CONFIRMED approach; USD provider OPEN (Section 20.3) |
| Payer picks EGP/USD at checkout; money arrives in the currency paid | CONFIRMED requirement; provider settlement behaviour to verify |
| Monthly plan 8 sessions, no rollover; tiers; pay-per-session never expires; Admin price in one currency + Admin exchange rate | CONFIRMED |
| Failed renewal = grace (default 3 days) then block new scheduling only | CONFIRMED |
| Annual plan | Not wanted now (monthly only) — PROPOSAL, confirm if needed |
| Supervisor = Admin minus money and minus managing admins/supervisors; may approve reports and applications | CONFIRMED (Section 4) |
| Money moves only after Admin/Supervisor approves the report | CONFIRMED (Section 7) |
| Scheduling blocked at zero credits; audited Admin/Supervisor override | CONFIRMED |
| Teacher payout monthly (Admin closes payroll) | CONFIRMED |
| Guardian WhatsApp on report approval; 2h reminder to teacher+student+guardian | CONFIRMED |
| Attachments: images + PDF, 10 MB, private | CONFIRMED |
| Class remark list (editable) | CONFIRMED |
| No mock data: full schema first, full seed, UI on real data | CONFIRMED (Section 13/21) |
| OpenWA credential delivery implemented now | CONFIRMED (Section 5) |
| Dashboards UI/UX pass, front-end only on mock data | CONFIRMED as next work; details PROPOSAL (Section 21) |

### Environment variable names (names only — never values in docs or Git)
`DATABASE_URL`, `DIRECT_URL`, `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `NEXTAUTH_SECRET`.
- Proposed by the coding agent for the first seed (names only): `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` (the code uses `SEED_ADMIN_USERNAME`, matching the username login).
- **Gap:** `.env.example` does not yet list `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID` — add them (names only) when the OpenWA provider is built.
- Gateway variables (names to confirm when the provider is chosen): `PAYMOB_API_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_ID` (names to confirm from the Paymob docs), and for the USD gateway `USD_GATEWAY_API_KEY`, `USD_GATEWAY_WEBHOOK_SECRET` (placeholders until the provider is chosen).
- **Removed:** all `ZOOM_*` variables (no Zoom API any more — delete them from `.env` too), `JWT_SECRET`, official-WhatsApp variables, webhook secret.
- To be added when their phase starts (names to confirm then): Supabase Storage credentials (Phase 5/6), Redis connection only if BullMQ is chosen.
- `.env` is never committed; `.env.example` contains names only.
- **Action:** secrets exposed during setup (database password, Zoom client secret, auth secret) must be rotated before any real data is stored (tracked in PROGRESS.md).

---

## 18. MVP cut line & Post-MVP backlog (working agreement 2026-09-29)

We build the **MVP only**. Anything disproportionately large is **documented in the phase spec files under "Deferred / Post-MVP" and implemented only when its time comes** — never silently dropped, never silently built early.

- **OUT OF SCOPE (owner):** embedded Zoom interface, recordings/replay, Zoom API.
- **MOVED INTO SCOPE (owner, 2026-10-06):** payment gateway with automatic recurring billing (Section 20); Supervisor role (Section 4); OpenWA credential delivery now (Section 5).
- **DEFERRED (owner):** SMS fallback (may never be built).
- **DEFERRED — documented for later:** Zoom API verification layer (real attendance proof from Zoom events, join/leave alerts, automatic checks against the teacher's report); student/guardian "dispute this attendance" button.
- **CANDIDATES to defer (PROPOSAL — owner decides):** low-balance alert; the post-session student evaluation prompt; announcements; recurring-schedule editing tools beyond generation; estimated-salary widget; activation-link credential flow.
- Everything in Section 11's "explicitly out of MVP" list stays out.

---

## 19. Product roadmap — SaaS after delivery (owner, 2026-09-29)

- **Plan:** first deliver the simple single-tenant system to Zarabicschool. **After that delivery** the product becomes a SaaS sold to other academies, like madarakeg.com. This is a **documented plan only — no SaaS work is done or scheduled now** (INSTRUCTIONS.md §9).
- **What the SaaS stage will need** (not estimated, not scheduled): real multi-tenancy (tenant context on every request, enforced and tested isolation, e.g. RLS with `SET LOCAL`), tenant onboarding and a super-admin, subscription plans and billing for academies, per-academy branding/domain/language/settings, per-academy WhatsApp number or provider, wallet payouts (the student-side payment gateway is already in scope — Section 20), automatic currency conversion, the optional Zoom API verification layer, SMS, stronger child-safety tooling, monitoring and support at scale, and legal documents (terms, privacy, data protection).
- **Cheap hygiene NOW so that conversion is not a rewrite:** `academy_id` on every tenant-owned table; no academy-specific constants hardcoded (brand text, currencies, rates) — keep them as configuration; decide consciously which uniqueness will be per academy later (PROPOSAL: `UNIQUE(academy_id, username)`); keep external providers behind interfaces; keep the money logic academy-agnostic.
- **Rule:** nothing from this list enters the MVP unless the owner moves it there.

---

## 20. Payment Gateways & Automatic Renewal (owner, 2026-10-06)

Supersedes the old "no payment gateway in MVP" lines. Moving it into scope was the owner's explicit decision.

### 20.1 Decisions — CONFIRMED by the owner
1. Online payment gateways are part of the platform. Students/guardians can be **anywhere in the world**.
2. **Two currencies: EGP and USD.** The payer chooses the currency at checkout; EGP → Paymob, USD → a second gateway. The money reaches the academy in the currency that was paid (EGP stays EGP, USD stays USD).
3. **Monthly subscription = 8 sessions per month, charged automatically every month, no rollover.** More than one plan/tier can exist (Admin-defined). Plus the **"على كيفك" pay-per-session** purchase (any number of sessions × the per-session price, never expires). Details: Section 7.
4. Prices are set by Admin in one currency and converted with an Admin-set exchange rate (snapshot stored on each invoice).
5. **The academy bears all financial costs** (agreed with Alaa; get it in writing): gateway fees, refunds, chargebacks, platform subscriptions. No fee is added to the payer's price; teacher pay is not reduced.
6. The payer for a minor is the guardian; an adult student without a guardian pays for themselves.
7. Failed renewal: a grace period (default 3 days, configurable), then only scheduling NEW sessions is blocked (20.6).
8. Provider choice (owner delegated it): **Paymob for EGP**, with a **second gateway for USD** next to it.

### 20.2 Why Paymob (EGP)
Egyptian, documented developer portal with an API explorer; a **Subscription Module** (weekly up to annual cycles) and card tokenization; refund/void via API; cards, wallets and installments for Egyptian payers; standard fee on its pricing page: 2.75% + 3 EGP per transaction. Good fit for Next.js route handlers + webhooks.
Caveats found in public pages (NOT verified with Paymob): third-party articles say Paymob settles only in local currency (EGP) — so it is **EGP-only** in our design; the pages disagree on settlement timing (weekly vs T+1).

### 20.3 The USD gateway — OPEN (needs verification before any code)
Stripe is not natively available for Egyptian merchants (it needs a foreign entity). Candidates for USD: a Merchant of Record (e.g. Paddle, Lemon Squeezy, Dodo Payments) or another provider with a USD settlement account. Not verified: payouts to Egypt, recurring support, fees, KYC. **Questions to put to every candidate and to Paymob:** does it settle USD as USD? payouts to an Egyptian bank/entity? stored-credential recurring charges + retry logic? webhook signature scheme? fees incl. refund/chargeback? sandbox? documents required?
Until this is answered, code only against our own `PaymentProvider` interface and a fake provider; the USD path stays disabled.

### 20.4 Architecture (CONFIRMED approach, provider-independent)
- **Hosted checkout only.** Card data never touches our servers or logs; we store provider tokens/ids only.
- The **webhook is the source of truth**, not the browser return page.
- Flow: payer presses Pay → server creates the checkout using the amount **from the Invoice in our DB, never from the client** → provider page → provider calls our webhook → signature verified → ONE transaction: webhook event recorded + Invoice `PAID` + `SubscriptionLedger` `INITIAL_PURCHASE` (+N) → notifications after commit.
- **Renewals:** RECOMMENDATION — our own renewal worker (the database-polling scheduler, Section 10) creates the next Invoice and charges the stored token, because the price can change with the exchange rate and we need the same logic for both gateways; provider-managed subscriptions are the alternative if a provider cannot charge stored tokens. OPEN — decide after the provider answers (20.3).
- **Idempotency (mandatory):** `UNIQUE(provider, provider_event_id)` on `WebhookEvents`; a duplicate event = "already processed". One renewal Invoice per (subscription, period).
- Tables (PROPOSAL — created in Phase 0): `BillingPlans` (Admin-defined; sessions per month, price in base currency), `ExchangeRates`, `BillingSubscriptions` (payer, plan, currency, status ACTIVE|PAST_DUE|CANCELED, provider ids, current_period_end), `WebhookEvents`; on `Invoices`: `source` (GATEWAY|MANUAL), `provider`, `provider_payment_id`, `gateway_fee_minor`, `exchange_rate_snapshot`.
- Webhook endpoint: no session auth; signature + replay window; rate-limited; never logs card, name or phone data.
- Refunds/chargebacks → `REFUND` / `ADMIN_ADJUSTMENT` entries, never edits. Only Admin issues refunds.

### 20.5 Consent and cancellation
Explicit consent to automatic renewal at the first payment; the guardian can cancel from their dashboard; a WhatsApp reminder before each renewal (and when the price changed). Terms/refund-policy wording is written by the academy, not invented by us.

### 20.6 Failed renewal
Provider retry (if any) → WhatsApp to the guardian and Admin → status `PAST_DUE` → after the grace period only **new** scheduling is blocked. Sessions already scheduled, reports, and teacher pay are never affected.

### 20.7 Tests required (Phase 6b)
Duplicate webhook; bad signature; amount mismatch vs Invoice; webhook before the Invoice exists; renewal success/failure; exchange-rate snapshot; rollback when the ledger insert fails; expiry entry at period end; refund entry; concurrent webhooks. The provider is mocked only at the HTTP boundary; the database is real.

---

## 21. Dashboards UI/UX plan (owner, 2026-10-06)

### 21.1 Rule
**No mock data.** Screens read the real seeded database (Phase 0). A thin typed data layer (`lib/data/*`, server-side queries per dashboard) is written by the backend side; the UI agent only renders what those functions return. If a function does not exist yet, the UI agent asks for it — it does not invent fake data.

### 21.2 Where we are
Four role dashboards exist as shells with empty cards; the only real admin screen is the applications inbox/detail/approve flow. Landing page and application forms are real.

### 21.3 Approach (PROPOSAL)
- One strong UI model builds all dashboards, one role per session, after Phase 0 is seeded.
- Shared **app shell**: sidebar (desktop) / drawer or bottom bar (mobile), RTL-first, role-based navigation, locale switcher, user menu; brand tokens (Navy/Emerald/Gold; Cairo/Tajawal/Montserrat).
- Every screen: loading, empty and error states; keyboard + screen-reader basics; mobile-first (the teacher dashboard above all).
- Done = the owner can click through every role on seeded data in Arabic and English, at mobile and desktop width.

### 21.4 First-screen content per role (from Sections 4–9, 20)
- **Admin:** pending applications, today's sessions, reports waiting approval, outage requests, failed/pending renewals and invoices, payroll balances per currency, teacher red marks, announcements.
- **Supervisor:** same as Admin without any money widgets and without managing Admins/Supervisors.
- **Teacher:** today's classes (student, time, subject, duration, status, Zoom button, report icon only after the end), total/done/remaining sessions, attended %, approved earnings per currency (+ pending-approval amount, PROPOSAL), late-report warnings.
- **Guardian:** one card per child (next session, remaining sessions, last approved report), subscription status + next renewal date + cancel action, invoices, announcements.
- **Student:** upcoming sessions with the Zoom button, attendance history, homework and notes from reports, remaining sessions (adult student without guardian also sees invoices).

### 21.5 Rules for the UI agent
Only UI files (`app/**`, `app/_components/**`, `messages/*.json`). Do not touch `prisma/**`, `lib/auth.ts`, `lib/dal.ts`, `proxy.ts`, or API routes. No new dependencies without asking. Money is shown from integer minor units formatted per currency. Supervisor views must not receive money fields at all (the data layer omits them).
