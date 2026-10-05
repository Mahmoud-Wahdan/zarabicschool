# Phase 2 — Educational Management

## Goal

Students, guardians, teachers, subjects, relationships, academic data. (CONTEXT.md §13, Phase 2.)

Build the CRUD operations and admin views for managing the core educational entities: students, guardians, teachers, and subjects, including the many-to-many teacher–subject assignments and the one-to-many guardian–student relationships.

## Proposed approach

1. **Database migrations:** Add `Guardians`, `Students`, `Teachers`, `Subjects`, `TeacherSubjects`, and `Applications` tables to Prisma schema.
2. **Application/Contact forms:** Public landing page multi-tab form for 3 distinct user roles (**Guardian**, **Student**, **Teacher**). Admin reviews, validates, and approves/rejects. On approval, admin accepts and system provisions account (User + role-specific profile), delivering temporary credentials via WhatsApp.
3. **Admin CRUD views:** Admin can create, view, edit, deactivate students, guardians, teachers, and subjects. Admin assigns teachers to subjects (many-to-many).
4. **Student–Guardian linking:** When creating a student, admin assigns exactly one guardian (father or mother). One guardian can have multiple students.
5. **Subject–Teacher assignment:** Admin assigns teachers to subjects (and vice versa). Students and admin can choose subject–teacher pairings, with admin confirmation.
6. **Role-scoped views:** Each role sees only their relevant data (teacher sees assigned students/subjects, guardian sees their children, student sees their own profile).
7. **Validation:** Zod schemas for all input. Server-side authorization checks on every mutation.

Delivery stage: Stage 1.

## Acceptance criteria

- Three public application types are rate-limited, validated, and routed to Admin without logging minor data.
- Admin can move `NEW → REVIEWED → APPROVED/REJECTED`; approval provisions the correct profile and links the source application.

## Frontend

Routes: `/apply/guardian`, `/apply/student`, `/apply/teacher`, `/admin/applications`, `/admin/students`, `/admin/teachers`, `/admin/subjects`. Include loading/empty/error states, blocked field placeholders until the owner decides form fields, RTL/i18n, mobile forms, and role-scoped lists.

## Backend

POST `/api/applications` accepts a type-specific Zod JSONB payload; Admin endpoints review, approve, reject, and provision. Use consistent 400/401/403/404/409 errors. Credential delivery uses `MessagingProvider`; NotificationLog never stores a password.

## Database

Touches `Guardians`, `Students`, `Teachers`, `Subjects`, `TeacherSubjects`, `Enrollments`, `Applications`, `Users`, and recommended `TeacherRates`. Approval/profile creation is one transaction. Seed subjects only when defined by the owner.

## Auth & Authorization

| Role | Submit public application | Review applications | Manage profiles | Confirm enrollment |
|---|---:|---:|---:|---:|
| Public | Yes | No | No | No |
| Admin | Yes | Yes | Yes | Yes |
| Teacher/Student/Guardian | No | No | Own limited view | No |

Server-side ownership checks prevent cross-student and cross-guardian access.

## Security

Rate-limit and validate public forms; use honeypot/captcha as an OPEN option; do not log names, phones, or minor details; protect temporary credentials; authorize every Admin mutation; SMS is post-MVP.

## Transactions & failure handling

Approval must atomically create the user/profile and link the application. If delivery fails after commit, retain a redacted NotificationLog failure and allow Admin retry without revealing the password in logs.

## Tests

Unit: each Zod application discriminant. Integration: public rate limit, minor guardian link, review transitions, duplicate enrollment rejection, unauthorized Admin mutation, and approval rollback. Playwright: all three forms and Admin provisioning.

## Learning checkpoint

- Why is application `details` validated by type before account creation?
- Which record owns the guardian link for a minor student?

## Open decisions

- ~~Exact fields for all three forms~~ — **CONFIRMED (owner, 2026-10-03)**:
  - **Guardian:** `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `children[] {name, age, subjects[]}`, `preferred_times` (optional), `notes` (optional).
  - **Student:** `full_name`, `date_of_birth`, `phone_whatsapp`, `timezone`, `preferred_language`, `subjects[]`, `level`, `preferred_times` (optional), `notes` (optional); if under 18: `guardian_name`, `guardian_phone`, `guardian_relationship` (father|mother) required.
  - **Teacher:** `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `subjects[]`, `years_experience`, `qualifications`, `available_times` (optional), `notes` (optional). REMOVE `expected_hourly_rate` and `currency` from `lib/validation/application.ts` — pay is agreed with Admin by human contact and entered by Admin later.
  - Keep the honeypot, size limit and per-IP rate limit.
- ~~`TeacherRates` table versus teacher fields~~ — **CONFIRMED (owner, 2026-10-03)**: effective-dated `TeacherRates` table (`id, teacher_id, hourly_rate_minor, currency, effective_from, created_by`). Built in Phase 6, NOT now. Rate rule CONFIRMED: a session is paid with the row whose `effective_from <=` the SESSION's scheduled start (not the approval time); the ledger credit stores `hourly_rate_snapshot_minor`.
- Public intake in Phase 1 versus Phase 2: remains Phase 2 (endpoints already exist early inside the Phase 1 branch).
- Provisioning rules — **CONFIRMED (owner, 2026-10-03)**: every child gets their own username + temporary password; a guardian application with N children = 1 guardian user + N student users, created in ONE transaction (all or nothing) and idempotent. Admin links a student to an existing guardian or creates the guardian in the same approval step. Admin can add manually from the dashboard at any time (guardian, student, teacher, subject, another admin). A new account's username and temporary password are shown to Admin ONCE; delivery by WhatsApp later via `MessagingProvider` (fake provider only until OpenWA wiring is decided). Username rule and guardian-message-on-approval are still OPEN — ask before coding Slice D.
- Login identifier (`username` vs email): OPEN — PROPOSAL: username.

## Deferred / Post-MVP

- [DEFERRED] SMS delivery, complex SaaS administration, and unrestricted self-service registration.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [x] Add Prisma schema: `Guardians`, `Students`, `Teachers`, `Subjects`, `TeacherSubjects` *(schema and un-applied Phase 2 migration are in the working tree; database application remains pending)*
- [x] Add Prisma schema: `Applications` (supporting Guardian, Student, Teacher applicant types) *(existing init schema extended with review/provisioning fields)*
- [ ] Run migrations *(blocked pending explicit development-database confirmation)*
- [x] Build public landing page application forms (3 tabs: Guardian, Student, Teacher)
- [x] Build admin application inbox & review UI (validate, accept, reject) *(list, detail, review/reject/approve actions, loading/error states)*
- [x] Build automated account provisioning flow on admin acceptance (User + profile + fake messaging provider) *(OpenWA delivery remains deferred behind `MessagingProvider`)*
- [ ] Build admin CRUD: Students
- [ ] Build admin CRUD: Guardians
- [ ] Build admin CRUD: Teachers
- [ ] Build admin CRUD: Subjects
- [ ] Build admin UI: Teacher–Subject assignment (many-to-many)
- [ ] Build teacher dashboard: view assigned students and subjects
- [ ] Build guardian dashboard: view linked children
- [ ] Build student dashboard: view own profile and assigned subjects
- [ ] Add Zod validation schemas for all entities
- [ ] Write tests: CRUD operations, authorization, relationships

## Execution log (updated as soon as real work happens)

- 2026-10-01: Phase 2 started early inside the Phase 1 branch, before owner confirmation of the form fields. Existing pieces: `Application` + `Subject` models inside the init migration (already applied to Supabase), `POST /api/applications` (rate limit, honeypot, size cap, 24h duplicate check), `GET /api/subjects` (public, active subjects), and `lib/validation/application.ts` with a concrete field list that is a **DRAFT** — the final field list must be confirmed by the owner before the application UI is built. Open items flagged for the plan: guardian link on the student application, username generation on provisioning, guardian message on approval, OpenWA wiring.
- 2026-10-03 (owner decisions — CONFIRMED): (1) Final application fields for all three forms (see Open decisions); `expected_hourly_rate`/`currency` removed from the teacher application; honeypot, size limit, per-IP rate limit kept. (2) Every child gets their own username + temporary password; guardian application with N children = 1 guardian user + N student users in ONE idempotent transaction. (3) Guardian linking: Admin links to an existing guardian or creates one in the same approval step; manual adds from the dashboard any time; credentials shown to Admin ONCE, delivered later via `MessagingProvider`. (4) Logo/contact info = clearly marked placeholders in a site config module; invent nothing. (5) NO Docker / NO separate test DB — the owner's Supabase DB used directly with demo data: `db:seed:demo` (all demo usernames start with `demo_`), `db:clear:demo` deletes ONLY `demo_*` records, tests create unique `demo_test_*` records and clean them up. Phase 6 exception documented (append-only ledger guards; see PROGRESS.md) — only the Phase 2 part (demo users, profiles, applications) implemented now. (6) `TeacherRates` = effective-dated table, built in Phase 6; rate row chosen by the SESSION's scheduled start; credit stores `hourly_rate_snapshot_minor`. The DRAFT `lib/validation/application.ts` must be rewritten to the confirmed fields in the application-forms slice.
- 2026-10-05 (working-tree implementation): The confirmed application form/API, localized Admin inbox, Admin dashboard link, application detail page, review/reject/approve controls, one-time credentials panel, profile provisioning service, fake messaging provider, Jest setup, and initial tests are present. `webapp` typecheck and ESLint pass. The Phase 2 migration has not been applied. Jest still has an approval timeout, validation expectation failures, an empty request test file, and open async handles; integration is not complete.
