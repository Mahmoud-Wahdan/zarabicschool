# ZARABICSCHOOL (Madarak) — Project Context

> Purpose: stable project facts and decisions. This file is CONTEXT, not behavioral rules (those live in INSTRUCTIONS.md).
> Owner: Mahmoud Wahdan. Client: Zarabicschool Academy (owned/managed by a woman referred to as "the ZarabicSchool owner" — get her exact name/title before writing it into user-facing docs).
> Adopted source-of-truth scope document: the official "ZarabicSchool" project overview (24 sections, Arabic) — supersedes earlier informal notes where they conflict.
> Last revised: 2026-09-30 — **6th revision**: NO Zoom API (Admin creates meetings in Zoom and pastes the link), Admin-approved teacher reports drive settlement, no recordings, no embedded Zoom, prepaid session packages, hourly teacher pay, staged delivery; plus per-student unified reports, explicit attendance, report approval/archive, no trial sessions, and the post-delivery SaaS roadmap (Section 19).
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
4. **Admin** — full control: applications, all accounts, subjects/relationships, schedules and **Zoom links**, reports review, outage requests, replacement sessions, finances, payroll adjustments and payouts, announcements. Admin provisions all accounts.

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

**Credential delivery:** primary WhatsApp via OpenWA — CONFIRMED. **SMS is post-MVP and may never be built** (CONFIRMED). PROPOSAL for the MVP fallback: Admin sees the temporary password once in the admin UI and delivers it manually.

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
1. A report can be submitted only by the assigned teacher, only for a session in her schedule, only **after the scheduled end time** (server-side check), and only once per (session, student). A rejected report returns to that teacher for editing and resubmission.
2. Every report follows `SUBMITTED → APPROVED → ARCHIVED`; Admin approval is required before settlement. After archival, neither Teacher nor Admin may edit the original report record.
3. Settlement runs only after approval in one idempotent transaction; anything wrong after archival is corrected with adjustment/refund ledger entries, never by editing history.
4. Students/guardians see attendance per session on their dashboards (natural cross-check). A "dispute" button is a Post-MVP candidate.
5. The Zoom button goes through a small platform redirect that logs "user X opened the link for session Y at time T" — soft evidence for Admin, not proof (PROPOSAL, tiny).
6. Later option (Post-MVP, only if the client wants proof): add a Zoom API verification layer on top; the ledger design does not change.

### Teacher experience (from the reference screenshots)
- **Dashboard:** total sessions/hours assigned, done, remaining, attended percentage, and **her salary so far, rising with each reported session**; fines/bonus appear as adjustments; an "estimated month salary" widget is optional (owner to say which widgets he wants).
- **Today's classes:** list of student rows (student name, date/time, subject, duration, status such as Attended / Waiting / Pending); a "View" action; the Zoom button beside the student.
- **Report icon** appears **only after the session ends** (PROPOSAL: once the scheduled end time has passed). It opens the **"End class" form**: Class Remark (required dropdown), Summary (required), Homework (required), Notes, Upload files (image / PDF / other). Options of the dropdown = OPEN.
- Mobile-first layout.

### Session model — CONFIRMED
- Private (1:1) and group (1:N), configured by Admin. Weekly recurring patterns instead of creating every session by hand.
- **Absences / outages / replacement sessions:** if a session does not take place, the teacher reports it (student absent, etc.) and no money moves. **Student or teacher can submit an outage/absence request through an in-app form (MVP)** → Admin queue. Admin coordinates the reason with the student side and the teacher as a human matter; the system does not relay it. Admin schedules a **replacement session** linked to the original (`replacement_for_session_id`).
- Removed with the Zoom events: the 25%-of-duration absence timer, late-join detection, "teacher joined / student joined" alerts. (The teacher marks the outcome in the report.)

### Notification chain (WhatsApp via OpenWA)
1. Session created → teacher notified.
2. About 2 hours before → reminder to the teacher (student too? confirm).
3. Scheduled end passed → teacher asked to write the report (mandatory); Admin approval later permits settlement. Student evaluation is separate and its mandatory status is OPEN.
4. Report still missing ~15 minutes later → second notification.
5. Still missing after that → **red mark** on the teacher, visible to Admin — for a late **report** only. PROPOSAL: T+0 notify, T+15 reminder, T+30 red mark. Timing measured from the scheduled end.
6. Optional low-balance warning when ~75% of the package is used (Post-MVP candidate).

---

## 7. Financial Model — teacher pay & student packages (HIGH RISK — treat like a payment system)

### The core rule — CONFIRMED (5th revision)
Two units, on purpose:
- **Student = prepaid subscription packages counted in SESSIONS** (e.g. the 500 package = 8 sessions), usable over one, two or more months, for any subject and any teacher; sessions **never expire**. The guardian knows the session length. Student money lives on Invoices (Section 12).
- **Teacher = money by the hour**, independent of what the student paid. The rate is agreed between the academy and each teacher and entered by Admin.

**The teacher's salary rises only when she submits her report on the student** (owner, 2026-09-29). Submitting the report is the trigger. In ONE database transaction, when the report says the student **attended**:
1. one `SESSION_DEDUCTION` (−1 session) for that student's subscription;
2. one `SESSION_CREDIT` to the teacher = **scheduled duration × her hourly rate** (created once per session by the first "attended" report, no matter how many students report; **reports are per student, also in group sessions — CONFIRMED**);
3. the approved report is settled and then archived.
If the report says the student did not attend (or the session did not take place) → no money moves and the session becomes MISSED.

**Pay basis = the scheduled duration** (time is not measured any more). **Overtime:** if she stayed longer she says so in the report and **Admin decides**; approved extra time is paid as an `ADMIN_ADJUSTMENT` (never by re-settling). Rounding to integer minor units: rule OPEN.

**Prepaid rules:** scheduling beyond the student's remaining sessions is blocked (audited Admin override); scheduled-but-unsettled sessions count against the remaining balance. If a balance still goes negative at settlement, settle anyway and flag Admin — the teacher's pay must never be blocked by the student's package.

### Double-payment protection — CONFIRMED design (built in Phase 6)
1. One transaction after Admin approval: ledger rows + report settled/archived markers commit or roll back together.
2. **One report per (session, student)** — a unique constraint; a duplicate submit/replay is answered as "already submitted". A rejected report reuses that row for correction and resubmission.
3. Unique constraints on the ledgers: one `SESSION_CREDIT` per session; one `SESSION_DEDUCTION` per (session, subscription). A duplicate insert = "already settled", not an error.
4. Before archival, a rejected report may be edited and resubmitted by its teacher. After archival, money-affecting and text fields are all frozen.
5. Server-side eligibility checks (assigned teacher, after scheduled end, session not cancelled).
6. Corrections only by `ADMIN_ADJUSTMENT` / `REFUND` entries — never by editing or deleting history.

### Dual ledger — CONFIRMED
- **`SubscriptionLedger`** (student, counted in sessions): append-only; `INITIAL_PURCHASE` (+N when Admin confirms the invoice), `SESSION_DEDUCTION` (−1), `ADMIN_ADJUSTMENT`, `REFUND`. Balance = sum of `sessions_delta`; no mutable counters.
- **`PayrollLedger`** (teacher, money per currency): append-only, never UPDATE/DELETE; `created_by = NULL` for system entries, NOT NULL for Admin; `SESSION_CREDIT`, `ADMIN_ADJUSTMENT` (fines, bonus, overtime), `DISBURSEMENT`. Each credit stores the report that triggered it, the minutes credited and the hourly-rate snapshot.

### Multi-currency — CONFIRMED
ISO codes (`USD`, `EGP`), teacher balances per currency, **no automatic conversion in MVP**. Admin converts manually and approves payouts.

### OPEN sub-decisions (do not invent — ask when implementation reaches them)
1. **Dropdown options** of "Class Remark" and the attendance-outcome values (attended / student absent / …).
2. **When the report becomes available** (PROPOSAL: after the scheduled end time; Admin can unlock).
3. **Attachment rules:** allowed file types and maximum size (PROPOSAL: allowlist of images + PDF, size cap, private storage, no executable files).
4. **Teacher hourly rate storage:** CONFIRMED (owner, 2026-10-03) — effective-dated `TeacherRates` table (`id, teacher_id, hourly_rate_minor, currency, effective_from, created_by`). **Built in Phase 6, not before.** Rate rule CONFIRMED: a session is paid with the rate row whose `effective_from <=` the **SESSION's scheduled start** (not the approval time); the ledger credit stores `hourly_rate_snapshot_minor`. Pay is agreed with Admin by human contact (outside the system) and entered by Admin later.
5. Rounding of hourly amounts to minor units.
6. Zero-sessions mechanism (blocking rule details, recurring generation capped to the remaining sessions).
7. Late-report reminder/red-mark timing; notification recipients beyond the confirmed ones (e.g. does the student also get the 2-hour reminder? does the guardian get a message when a report is submitted?).
8. **Application form fields** — CONFIRMED (owner, 2026-10-03; final):
   - **Guardian:** `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `children[] {name, age, subjects[]}`, `preferred_times` (optional), `notes` (optional).
   - **Student:** `full_name`, `date_of_birth`, `phone_whatsapp`, `timezone`, `preferred_language`, `subjects[]`, `level`, `preferred_times` (optional), `notes` (optional); if under 18: `guardian_name`, `guardian_phone`, `guardian_relationship` (father|mother) required.
   - **Teacher:** `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `subjects[]`, `years_experience`, `qualifications`, `available_times` (optional), `notes` (optional). **No `expected_hourly_rate` / currency** — pay is agreed with Admin by human contact and entered by Admin later.
   - Keep the honeypot, size limit and per-IP rate limit.
   - **Login identifier** (`username` vs email): still OPEN — PROPOSAL: username.
9. Which teacher-dashboard widgets are in the MVP (estimated salary, fines/bonus display).
10. Whether the student sees the homework part of the teacher's report.
11. How Admin reverses a wrongly settled report (PROPOSAL: one action that writes the reversing ledger entries) and the payout cycle (monthly?).
12. Evaluation-form fields (Phase 7).

*Resolved:* prepaid session packages that never expire; pay is hourly and independent of the student's price; **Admin-approved reports drive settlement**; **reports are unified per student/session with Teacher and Student relationships, also in groups (the teacher's credit is created once per session by the first approved attended report)**; **archived reports are visible to Admin, Teacher, the linked guardian, or the student directly when no guardian exists**; attendance remains explicit on SessionStudents; overtime is decided by Admin from the report; the outage/absence form is in the MVP; the red mark is for late reports only; **no trial-session type**; no Zoom API, no recordings, no embedded interface; **TeacherRates = effective-dated table (CONFIRMED 2026-10-03, built in Phase 6; rate row chosen by the SESSION's scheduled start; credit stores `hourly_rate_snapshot_minor`)**; **application fields for all three forms (CONFIRMED 2026-10-03, see item 8)**.

---

## 8. WhatsApp — role clarified

WhatsApp is used **only** for: credential delivery, registration/status updates, payment info, session and report reminders, payroll-related alerts. It is not authentication and not a source of truth.

**Provider: CONFIRMED — OpenWA** (self-hosted, unofficial, whatsapp-web.js based), because the official Cloud API could not be obtained.
- Auth: `X-API-Key` header; sending number linked via a QR-scanned session.
- Currently running locally without Docker; session connected.
- Behind a `MessagingProvider` interface.
- **Risk:** unofficial → number can be banned. Dedicated number; never the only channel for critical flows.

---

## 9. Reports & Evaluations — CONFIRMED MVP feature

- **Teacher session report (mandatory; Admin approval is required before settlement):** class remark, summary, homework, notes, optional attachments (Section 6). Written **per student**, also in group sessions (CONFIRMED). Archived reports are visible to authorized related parties.
- Teacher free-text progress report per student (longer-term) — may be the same report stream; confirm in Phase 7.
- Student/Guardian can write a report/evaluation about a teacher — **visible to Admin only** (CONFIRMED).
- Automatic post-session evaluation form to the student — **optional**, no consequence if late or missing (fields = OPEN, Phase 7).
- Teacher lateness with the report is tracked (notifications + red mark).

---

## 10. Technology Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, TypeScript, `next-intl` (Arabic primary + English, RTL first-class).
- **Backend/API:** Next.js route handlers / server actions.
- **Background work:** timed notifications (2h reminder, report reminders, red mark) and the OpenWA sender need something running continuously. OpenWA itself is a self-hosted service that must stay up. OPEN: BullMQ + Redis (original choice) vs a simple database-polling scheduler for the MVP (fewer moving parts) — decide in the Phase 1 architecture note.
- **Database/ORM:** PostgreSQL + Prisma on **Supabase** (transaction-mode pooler `DATABASE_URL` + `DIRECT_URL` for migrations) — CONFIRMED. Partial unique indexes, CHECK constraints and triggers are raw SQL inside Prisma migrations.
- **File storage:** private **Supabase Storage** buckets (payment proofs and report attachments); DB stores `file_path`; access via short-lived signed URLs.
- **Video:** Zoom used from outside the platform via links (Section 6). No Zoom SDK, no Zoom API client.
- **Messaging:** OpenWA behind `MessagingProvider`. SMS: post-MVP, may never be built.
- **Validation:** Zod. **Testing:** Jest + Supertest, React Testing Library, Playwright.
- **Database for tests (CONFIRMED owner, 2026-10-03):** NO Docker and NO separate test database. The owner's Supabase DB is used directly — it contains no real data. Demo data via `db:seed:demo` (every demo username starts with `demo_`), `db:clear:demo` deletes ONLY `demo_*` records, tests create unique `demo_test_*` records and delete them afterwards. Phase 6 exception (documented; guards listed in PROGRESS.md): after append-only ledgers exist, demo data can still be cleared via the dedicated script with strict guards; the append-only trigger is never dropped or disabled globally.
- **Hosting:** decided at deployment time (owner, 2026-09-29). Working assumption: a small VPS for the web app and the always-on pieces.

---

## 11. Tenancy & Scope — DECIDED

- **Single-tenant for Zarabicschool only.** No multi-tenant middleware, no RLS now.
- Keep an `academy_id` column (single seeded academy row, not an env var) on tenant-owned tables for a later SaaS conversion. Schema convention, not a security boundary in v1.
- *Future note:* if RLS is added later, set tenant context with `SET LOCAL` inside a transaction (transaction-mode pooling).
- **Explicitly out of MVP:** payment gateways, multi-institution support, complex SaaS administration. (The post-delivery SaaS plan is in Section 19.)

---

## 12. Payment Model (student-facing) — DECIDED

Fully manual for MVP: student/guardian submits payment proof (receipt image or transaction reference, private Supabase Storage) → invoice `PENDING` → Admin verifies against the real bank/wallet → Admin confirms → invoice `PAID` → `SubscriptionLedger` gets an `INITIAL_PURCHASE` entry (+N sessions of the package). The package is **paid in advance**. No Paymob/Stripe in MVP. Money is integer minor units + ISO currency everywhere.

---

## 13. Implementation Phases

1. **Foundation** — platform structure, login, accounts, permissions, basic dashboards.
2. **Educational management** — students, guardians, teachers, subjects, relationships, the three applications and their approval/provisioning.
3. **Schedules & sessions** — schedule creation, recurring patterns, Zoom link per session, replacement sessions, session log.
4. **Live sessions via Zoom links** — the Zoom button (with the small logging redirect), link management by Admin, teacher/student session lists. *Now a small phase.*
5. **Session reports & attendance** (the spec file name still says "recordings"; there is no recordings feature) — report form with attachments, attendance from reports, notifications and red mark, outage/absence requests, overtime approval.
6. **Financial management** — manual payment confirmation (Section 12) + report-triggered hourly settlement (Section 7).
7. **Admin & reports** — admin dashboard, review queues, evaluations, announcements.
8. **Testing & launch.**

Each phase has a living spec file under `docs/specs/` (INSTRUCTIONS.md Section 22).

---

## 14. Timeline — delivery in stages (owner, 2026-09-29)

- **The client receives the system in stages** (CONFIRMED). Stage boundaries and dates are OPEN. PROPOSAL: Stage 1 = Phases 1–3; Stage 2 = Phases 4–5; Stage 3 = Phases 6–7; Phase 8 spans all.
- **Effort estimate (PROPOSAL, after removing the Zoom API/WebSocket/reconciliation, embedded Zoom and recordings):** about **70–110 focused hours** with AI writing much of the code. At 6–12 h/week that is about **9–14 weeks**. The original client target of 4–6 weeks needs roughly 20–30 h/week.
- The staged plan and dates still need to be agreed with Alaa/Zarabicschool.

---

## 15. Learning Path Integration — LIVE STATUS

1. ✅ JavaScript fundamentals/internals — completed
2. 🔶 Testing fundamentals + Jest — Jest done; React Testing Library in progress
3. ⬜ Git workflow/security → DSA → TypeScript → Advanced React/Node/Prisma deepening → Next.js full-stack → security/performance/accessibility/deployment

The project must not become an excuse to skip fundamentals. When a task needs an unmastered concept: explain it → show why the project needs it → let the owner attempt/reason → AI accelerates implementation → verification checkpoint.

---

## 16. Definition of Success

**Product:** Zarabicschool can run live classes (through Zoom links), scheduling, report-based explicit attendance, Admin-approved atomic hourly teacher settlement, prepaid student packages with manual billing, and the separate reports/evaluation loop — end to end, for real.

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
| Three application forms and their flow | CONFIRMED; **fields CONFIRMED (2026-10-03, CONTEXT §7 item 8)** |
| Auth = NextAuth only, forced password change, no self-reset, login rate limit | CONFIRMED |
| Supabase (Postgres + private Storage) | CONFIRMED |
| Delivery to the client in stages | CONFIRMED (boundaries OPEN) |
| Hosting | OPEN until deployment |
| Scheduler for timed notifications (BullMQ+Redis vs DB polling) | OPEN |
| Reports per student (also in groups); teacher report visible to guardian + Admin; student evaluation visible to Admin only; no trial sessions | CONFIRMED |
| Class-remark options; report availability; attachment rules | OPEN (Section 7) |
| SaaS conversion after the Zarabicschool delivery | CONFIRMED as a plan (Section 19); nothing built now |
| Teacher hourly rate storage (table recommended) | CONFIRMED (2026-10-03): effective-dated `TeacherRates` table, built in Phase 6; rate row chosen by the SESSION's scheduled start; credit stores `hourly_rate_snapshot_minor` |
| Login identifier: username vs email | OPEN — PROPOSAL: username |
| Zoom account cost / capacity (Alaa not yet informed) | OPEN |

### Environment variable names (names only — never values in docs or Git)
`DATABASE_URL`, `DIRECT_URL`, `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `NEXTAUTH_SECRET`.
- Proposed by the coding agent for the first seed (names only): `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`.
- **Removed:** all `ZOOM_*` variables (no Zoom API any more — delete them from `.env` too), `JWT_SECRET`, official-WhatsApp variables, webhook secret.
- To be added when their phase starts (names to confirm then): Supabase Storage credentials (Phase 5/6), Redis connection only if BullMQ is chosen.
- `.env` is never committed; `.env.example` contains names only.
- **Action:** secrets exposed during setup (database password, Zoom client secret, auth secret) must be rotated before any real data is stored (tracked in PROGRESS.md).

---

## 18. MVP cut line & Post-MVP backlog (working agreement 2026-09-29)

We build the **MVP only**. Anything disproportionately large is **documented in the phase spec files under "Deferred / Post-MVP" and implemented only when its time comes** — never silently dropped, never silently built early.

- **OUT OF SCOPE (owner):** embedded Zoom interface, recordings/replay, Zoom API.
- **DEFERRED (owner):** SMS fallback (may never be built).
- **DEFERRED — documented for later:** Zoom API verification layer (real attendance proof from Zoom events, join/leave alerts, automatic checks against the teacher's report); student/guardian "dispute this attendance" button.
- **CANDIDATES to defer (PROPOSAL — owner decides):** low-balance alert; the post-session student evaluation prompt; announcements; recurring-schedule editing tools beyond generation; estimated-salary widget; activation-link credential flow.
- Everything in Section 11's "explicitly out of MVP" list stays out.

---

## 19. Product roadmap — SaaS after delivery (owner, 2026-09-29)

- **Plan:** first deliver the simple single-tenant system to Zarabicschool. **After that delivery** the product becomes a SaaS sold to other academies, like madarakeg.com. This is a **documented plan only — no SaaS work is done or scheduled now** (INSTRUCTIONS.md §9).
- **What the SaaS stage will need** (not estimated, not scheduled): real multi-tenancy (tenant context on every request, enforced and tested isolation, e.g. RLS with `SET LOCAL`), tenant onboarding and a super-admin, subscription plans and billing for academies, per-academy branding/domain/language/settings, per-academy WhatsApp number or provider, online payment gateways and wallet payouts, automatic currency conversion, the optional Zoom API verification layer, SMS, stronger child-safety tooling, monitoring and support at scale, and legal documents (terms, privacy, data protection).
- **Cheap hygiene NOW so that conversion is not a rewrite:** `academy_id` on every tenant-owned table; no academy-specific constants hardcoded (brand text, currencies, rates) — keep them as configuration; decide consciously which uniqueness will be per academy later (PROPOSAL: `UNIQUE(academy_id, username)`); keep external providers behind interfaces; keep the money logic academy-agnostic.
- **Rule:** nothing from this list enters the MVP unless the owner moves it there.
