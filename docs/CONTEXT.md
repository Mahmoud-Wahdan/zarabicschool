# ZARABICSCHOOL (Madarak) — Project Context

> Purpose: stable project facts and decisions. This file is CONTEXT, not behavioral rules (those live in INSTRUCTIONS.md).
> Owner: Mahmoud Wahdan. Client: Zarabicschool Academy (owned/managed by a woman referred to as "the ZarabicSchool owner" — get her exact name/title before writing it into user-facing docs).
> Adopted source-of-truth scope document: the official "ZarabicSchool" project overview (24 sections, Arabic) — supersedes earlier informal notes where they conflict.
> Last revised: 2026-09-28 (Zoom event delivery = WebSocket; WhatsApp = OpenWA).

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

---

## 3. Brand / Design Reference

- **Name:** Zarabicschool — "تعلّم العربية والقرآن ... بنيَة تضيء قلبك" / "Learn Arabic & Quran... with a foundation that lights your heart"
- **Colors:** Navy Blue `#1B365D` (primary — trust/academic), Emerald Green `#00897B` (secondary/CTA — Islamic identity/growth), Warm Gold `#D4AF37` (accent — quality/premium). Suggested mix: 60% neutral, 30% Navy/Emerald, 10% Gold accent.
- **Typography:** Arabic — Cairo (headings) / Tajawal (body). English — Montserrat.
- **Logo:** combines Arabic letter ز (Z) and ع (A) inside a mihrab/dome-shaped frame. Full logo/variant files referenced in the brand PDF — use those assets directly rather than recreating them.
- Full brand guideline PDF is the source of truth for anything not summarized here (icon set, clear-space rules, application matrix).

---

## 4. Users & Roles (from the adopted scope doc)

1. **Student** — views own data, schedule, upcoming/past sessions, join links, recordings (when available), attendance history, announcements.
2. **Guardian** — centralized view across all linked children: schedules, attendance, recordings, financial status, teacher-written progress reports, updates.
3. **Teacher** — own schedule, assigned students, session join, past-session log, attendance marking, financial/payroll info, writes per-student reports, receives per-student evaluation forms back.
4. **Admin** — full control: applications/leads, all accounts, subjects/relationships, schedules, live sessions, attendance, recordings, finances, announcements, reports.

---

## 5. Onboarding Flow — DECIDED (with one open sub-question)

**Public site → Application/Contact form → Admin reviews → Admin approves & provisions account → credentials sent to student/guardian → normal username/password login.**

No public self-registration. No WhatsApp-based authentication (WhatsApp is used only for notifications — see Section 8). Login is a standard, single, admin-gated credential system, not WhatsApp-dependent.

**OPEN:** the channel used to deliver credentials. WhatsApp goes through an unofficial provider (OpenWA) and the number can be banned, and sending a password in plain text is weak. Options to evaluate: fallback channel, one-time activation link, forced password change on first login.

---

## 6. Live Sessions — DECIDED: Zoom, not embedded video

**Sessions happen on Zoom (the actual Zoom app/client), not inside the platform via an embedded video SDK (LiveKit is NOT used).** This directly addresses the Zarabicschool owner's complaint about madarakeg.com's weaker embedded classroom experience.

### Confirmed integration model
- **Zoom API + WebSocket event subscription** (Server-to-Server OAuth app, event subscription method = WebSocket) is used to detect: meeting started, participant joined/left, meeting ended. These events are the source of truth for attendance and payroll triggers. **No webhooks are used.**
- **Manual teacher-submitted session report is a fallback only**, used specifically when Zoom itself has a technical failure — not the primary mechanism.
- **Assumption to verify:** Zarabicschool needs a Zoom **Pro or Business** account (free accounts may not support Server-to-Server OAuth apps/event subscriptions at the needed scope). Confirm before scheduling Zoom-integration work.
- **Open:** Zoom plan and cost — Alaa has not yet been informed. Also open: recording availability and attendance-data availability per plan.

### How the WebSocket connection works (constraints the design must respect)
- Access token is obtained via Server-to-Server OAuth (`account_credentials` grant) and expires after about one hour → token refresh is required.
- The token is appended to the WebSocket URL when opening the connection. The base URL (with `subscriptionId`) lives in an env var; the token is never stored.
- A heartbeat message must be sent every 30 seconds to keep the connection alive.
- **Zoom delivers events only while the connection is open. Events that occur while it is closed are NOT delivered later.** Therefore: automatic reconnect is mandatory, and a **reconciliation job** (via Zoom REST API) is required so payroll never depends solely on a live connection. Endpoint availability for reconciliation on the academy's plan = assumption to verify.
- Since there is no webhook signature, every event must be treated as untrusted input: validate its schema (Zod) and enforce idempotency before crediting anything.

### Notification chain (via WhatsApp, triggered by admin/schedule/Zoom events)
1. Admin adds a session → Teacher gets WhatsApp notification to check her dashboard.
2. 2 hours before session → reminder to teacher (and presumably student — confirm both).
3. Teacher joins >3 minutes late → late-arrival notification (recipient(s) to confirm — likely Admin and/or Guardian).
4. Student joins → notification (to whom — likely Guardian).
5. Session ends (via Zoom "meeting ended" event) → automatic payroll increment is triggered.

---

## 7. Financial Model — teacher payroll auto-calculation (HIGH RISK — treat like a payment system)

**Confirmed logic:** a student subscription (e.g. $40) is divided by a per-session price (e.g. $10) → each completed, Zoom-verified session deducts $10 from the student's subscription balance **and** credits that amount to the teacher's payroll, automatically, triggered by the Zoom "meeting ended" event.

**This must be engineered with the same rigor as a payment system, even though no money gateway is involved**, because it is real automated financial accounting:
- **Idempotency is mandatory**: the same "meeting ended" event can be processed more than once (reconnects, reconciliation overlapping with live events). A session/payroll credit must never be counted twice.
- **Auditability is mandatory**: every payroll credit must record which Zoom event triggered it, its source (live WebSocket vs. reconciliation), timestamp, and which session/teacher/student — not just a final number.
- **Missed events must be recoverable**: see reconciliation in Section 6.
- **Student payment itself remains manual** (bank transfer/Vodafone Cash + admin review + receipt upload) — only the *teacher payroll accrual per completed session* is automatic via Zoom.

### Open sub-decisions (do not invent, ask when implementation reaches them)
1. What happens when a student's subscription balance runs out mid-cycle (e.g., 4 of 4 sessions used, 5th requested)? — explicitly parked as "needs more thought," not resolved.
2. Exact recipients for each WhatsApp notification in Section 6 (teacher only? guardian too? admin too?) — needs one clarifying pass with the Zarabicschool owner.
3. Late-arrival threshold (3 minutes) — is this purely informational, or does it also affect payroll (e.g., partial session credit)?
4. Reconciliation policy: who verifies sessions missed during a disconnect, how often the job runs, and what happens when Zoom data is unavailable.

---

## 8. WhatsApp — role clarified

WhatsApp is used **only** for: account credential delivery (channel = OPEN, see Section 5), registration/status updates, payment info, session reminders, attendance-related alerts (late arrival, join confirmation), and payroll-related alerts. It is explicitly **not** an authentication mechanism (see Section 5) and **not** the source of truth for attendance (Zoom events are — see Section 6).

**Provider: CONFIRMED — OpenWA** (self-hosted, unofficial, based on whatsapp-web.js) instead of the official WhatsApp Cloud API, which could not be obtained.
- Auth: `X-API-Key` header. The sending number is linked through a QR-scanned session, not through a phone-number ID.
- Must sit behind a `MessagingProvider` interface.
- **Risk:** unofficial, so the number can be banned. Use a dedicated number, and never make WhatsApp the only channel for critical flows (credentials, payment confirmation).

---

## 9. Additional confirmed MVP feature: Reports & Evaluations

Per the Zarabicschool owner's explicit emphasis, the following are **in scope for MVP** (confirmed simpler than the Zoom/payroll work, but still real implementation time — forms + role-scoped views for all 4 roles):
- Teacher can write a free-text report per student.
- Student/Guardian can write a report/evaluation about a teacher.
- Automatic post-session evaluation form sent to the student about the teacher.

---

## 10. Technology Stack

- **Frontend:** Next.js (App Router), Tailwind CSS, TypeScript, `next-intl` (Arabic primary + English, RTL first-class).
- **Backend/API:** Next.js API Routes and/or Node.js + Express. **OPEN:** because the Zoom WebSocket client, OpenWA, and BullMQ workers need a long-running Node process (not serverless), the API/worker architecture and hosting must be decided (see Section 17).
- **Database/ORM:** PostgreSQL + Prisma. Currently hosted on Supabase via the shared pooler (transaction mode, `DATABASE_URL` with pgbouncer) plus `DIRECT_URL` for migrations — **confirm as final.**
- **Video:** Zoom (external), integrated via Zoom API + WebSocket events — no embedded video SDK.
- **Messaging:** OpenWA (confirmed, see Section 8), behind `MessagingProvider`.
- **Background jobs:** BullMQ + Redis (reminders, scheduled notices, reconciliation job).
- **Validation:** Zod.
- **Testing:** Jest + Supertest, React Testing Library, Playwright.

---

## 11. Tenancy & Scope — DECIDED

- **Single-tenant for Zarabicschool only in this build.** No multi-tenant middleware, no cross-academy RLS logic implemented now.
- **Schema hygiene for the future:** keep an `academy_id` column (fixed/constant value for now) on tenant-owned tables, so a later SaaS conversion doesn't require a full data-model rewrite. This is a schema convention, not a security boundary in v1 — there is only one tenant, so RLS enforcement is deferred, not a live gap.
- *Future note:* if RLS is added later, tenant context must be set with `SET LOCAL` inside a transaction, because session-level settings do not persist under transaction-mode pooling.
- **Explicitly out of MVP** (per the adopted scope doc, Section 20): integrated multi-currency/multi-gateway online payment, multi-institution (multi-tenant) support, complex SaaS administration (billing plans, tenant self-serve, etc.).

---

## 12. Payment Model (student-facing) — DECIDED

Fully manual for MVP: student/guardian submits payment proof (transaction reference or receipt image) → invoice status "pending" → Admin manually verifies against the real bank/wallet account → Admin confirms → invoice "paid." No Paymob/Stripe integration in MVP (explicitly deferred).

Store money as integer minor units even in this manual model, so a future gateway integration doesn't require a schema migration.

---

## 13. Implementation Phases (adopted from the official scope document, Section 19)

1. **Foundation** — platform structure, login, accounts, permissions, basic dashboards.
2. **Educational management** — students, guardians, teachers, subjects, relationships, academic data.
3. **Schedules & sessions** — schedule creation, upcoming sessions, session log.
4. **Live learning** — Zoom integration (Section 6).
5. **Attendance & recordings** — attendance tracking (Zoom-event-driven), session log, recordings access (if/when available from Zoom).
6. **Financial management** — manual payment confirmation (Section 12) + automatic teacher payroll accrual (Section 7).
7. **Admin & reports** — full admin dashboard, reporting, the evaluation/report feature (Section 9).
8. **Testing & launch** — bug fixing, UX polish, performance, launch prep.

Each phase gets its own living spec file under `docs/specs/` — see the companion Gemini bootstrap prompt for the exact mechanism (read progress → continue → update file after execution).

---

## 14. Timeline — NOT YET RECONCILED WITH THE CLIENT

Given the confirmed manual-payment model (simpler than a real gateway) but the *added* real complexity of genuine Zoom API/event integration + automated payroll accrual (a real financial-logic system) + reports/evaluations, a realistic estimate for a single learning developer (~1–2 hrs/day, 6 days/week) is closer to **8–12 weeks**, not the "around a month" the client has informally mentioned. This gap has not yet been discussed explicitly with Alaa/Zarabicschool and should be, ideally before Phase 4–6 are underway, not discovered at the deadline.

---

## 15. Learning Path Integration — LIVE STATUS

1. ✅ JavaScript fundamentals/internals — completed
2. 🔶 Testing fundamentals + Jest — Jest done; React Testing Library in progress
3. ⬜ Git workflow/security → DSA → TypeScript → Advanced React/Node/Prisma deepening → Next.js full-stack → security/performance/accessibility/deployment

The project must not become an excuse to skip fundamentals. When a task needs an unmastered concept: explain it → show why the project needs it → let the owner attempt/reason → AI accelerates implementation → verification checkpoint.

---

## 16. Definition of Success

**Product:** Zarabicschool can run live classes (via Zoom), scheduling, Zoom-verified attendance, automatic teacher payroll accrual, manual student billing, and the reports/evaluation loop — end to end, for real.

**Developer:** the owner can explain the Zoom event flow (WebSocket, reconnect, reconciliation), the payroll idempotency mechanism, the auth/onboarding flow, the database schema's shape, and what AI generated vs. what he decided and why — for every non-trivial piece.

---

## 17. Integration decisions & environment (2026-09-28)

### Status table
| Topic | Status |
|---|---|
| Zoom instead of embedded video | CONFIRMED |
| Zoom event delivery = WebSocket (no webhook) | CONFIRMED |
| WhatsApp = OpenWA (unofficial) behind `MessagingProvider` | CONFIRMED |
| Zoom plan / cost (Alaa not yet informed) | OPEN |
| Which Zoom account owns the Server-to-Server OAuth app (Mahmoud's vs. Zarabicschool's) | OPEN — events only arrive from the account that owns the app |
| Hosting / long-running process model | OPEN |
| Supabase as final Postgres host | TO CONFIRM |
| Credential delivery channel | OPEN |
| Reconciliation policy for missed Zoom events | OPEN |

### Process model (consequence of WebSocket + OpenWA + BullMQ)
A long-running Node process is required. It cannot run on serverless platforms. Exact architecture (Next.js only vs. separate Express service/worker) is open.

### Environment variable names (names only — never values in docs or Git)
`DATABASE_URL`, `DIRECT_URL`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBSOCKET_URL`, `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `JWT_SECRET`, `NEXTAUTH_SECRET`.
- `ZOOM_WEBSOCKET_URL` holds the base URL with `subscriptionId` only; the access token is generated at runtime.
- Removed: `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (official Cloud API only), `ZOOM_WEBHOOK_SECRET_TOKEN` (webhooks are not used).
- `JWT_SECRET` and `NEXTAUTH_SECRET` must be different values.
- `.env` is never committed; `.env.example` contains names only.
