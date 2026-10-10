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
| Supervisor | No | No | Yes (operational profiles) | Yes; no applications, money, or Admin/Supervisor management |
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

- [x] Add Prisma schema: `Guardians`, `Students`, `Teachers`, `Subjects`, `TeacherSubjects` *(applied and verified on the development database)*
- [x] Add Prisma schema: `Applications` (supporting Guardian, Student, Teacher applicant types) *(existing init schema extended with review/provisioning fields)*
- [x] Run migrations *(development database reset and migration application verified on 2026-10-06)*
- [x] Build public landing page application forms (3 tabs: Guardian, Student, Teacher)
- [x] Build admin application inbox & review UI (validate, accept, reject) *(list, detail, review/reject/approve actions, loading/error states)*
- [x] Build automated account provisioning flow on admin acceptance (User + profile + fake messaging provider) *(OpenWA delivery remains deferred behind `MessagingProvider`)*
- [x] Build admin CRUD: Students *(academy-scoped create, update, activation/deactivation API and UI)*
- [x] Build admin CRUD: Guardians *(academy-scoped create, update, activation/deactivation API and UI)*
- [x] Build admin CRUD: Teachers *(academy-scoped create, update, activation/deactivation API and UI)*
- [x] Build admin CRUD: Subjects *(academy-scoped create, update, activate/deactivate API and localized UI)*
- [x] Build admin UI: Teacher–Subject assignment (many-to-many) *(duplicate-protected API and UI)*
- [x] Build teacher dashboard: view assigned students and subjects *(server-side data fetch and metrics)*
- [x] Build guardian dashboard: view linked children *(server-side data fetch and session balances)*
- [x] Build student dashboard: view own profile and assigned subjects *(server-side data fetch and upcoming sessions)*
- [x] Build SuperAdmin CRUD: Admin/Supervisor activation and deactivation *(privileged account API and UI; profile edit fields remain to be expanded)*
- [x] Build admin UI: Session enrollment management *(academy-scoped session/student selection, subject/teacher display, duplicate-safe add/remove)*
- [x] Repair Supervisor operational actions *(shared proxy authorization now permits Supervisor access to the application review surface)*
- [x] Rework dashboard metric presentation *(real counts, centralized visual tokens, and metrics-first SuperAdmin/Supervisor surfaces)*
- [x] Add Zod validation schemas for all entities *(profiles, subjects, assignments, and enrollments)*
- [x] Close Phase 2 implementation scope *(CRUD, relationships, enrollment UI, seed, and migration are complete; database-backed tests explicitly deferred per owner instruction)*
- [ ] PLAN (2026-10-10, awaiting owner approval): create `StudentSubject` automatically inside the student/guardian application-approval transaction *(idempotent, unique per pair, from `subjects[]`; `ON DELETE RESTRICT`, `academy_id`)*
- [ ] PLAN (2026-10-10, awaiting owner approval): optional per-subject teacher selection during student/guardian approval — for each subject, eligible teachers come from `TeacherSubject`; a selected teacher creates an `StudentTeacherAssignment` (ACTIVE) in the same transaction; no selection → approval proceeds and the student lands in the "Needs Teacher" list
- [ ] PLAN (2026-10-10, awaiting owner approval): assignment management APIs for Admin/Supervisor (create / terminate / list with filters + `GET /api/admin/teachers/:id/context`) and one simple `/admin/assignments` page covering assignments and "Needs Teacher" requests
- [ ] PLAN (2026-10-10, awaiting owner approval): harden the Phase 2 enrollment side-door (`POST/DELETE /api/admin/enrollments`) — add ACTIVE-assignment check (Admin/Supervisor override with reason only), SCHEDULED-only sessions, credit reservation inside the transaction, and reservation release on remove (owner decision 2026-10-10)

## Execution log (updated as soon as real work happens)

- 2026-10-01: Phase 2 started early inside the Phase 1 branch, before owner confirmation of the form fields. Existing pieces: `Application` + `Subject` models inside the init migration (already applied to Supabase), `POST /api/applications` (rate limit, honeypot, size cap, 24h duplicate check), `GET /api/subjects` (public, active subjects), and `lib/validation/application.ts` with a concrete field list that is a **DRAFT** — the final field list must be confirmed by the owner before the application UI is built. Open items flagged for the plan: guardian link on the student application, username generation on provisioning, guardian message on approval, OpenWA wiring.
- 2026-10-03 (owner decisions — CONFIRMED): (1) Final application fields for all three forms (see Open decisions); `expected_hourly_rate`/`currency` removed from the teacher application; honeypot, size limit, per-IP rate limit kept. (2) Every child gets their own username + temporary password; guardian application with N children = 1 guardian user + N student users in ONE idempotent transaction. (3) Guardian linking: Admin links to an existing guardian or creates one in the same approval step; manual adds from the dashboard any time; credentials shown to Admin ONCE, delivered later via `MessagingProvider`. (4) Logo/contact info = clearly marked placeholders in a site config module; invent nothing. (5) NO Docker / NO separate test DB — the owner's Supabase DB used directly with demo data: `db:seed:demo` (all demo usernames start with `demo_`), `db:clear:demo` deletes ONLY `demo_*` records, tests create unique `demo_test_*` records and clean them up. Phase 6 exception documented (append-only ledger guards; see PROGRESS.md) — only the Phase 2 part (demo users, profiles, applications) implemented now. (6) `TeacherRates` = effective-dated table, built in Phase 6; rate row chosen by the SESSION's scheduled start; credit stores `hourly_rate_snapshot_minor`. The DRAFT `lib/validation/application.ts` must be rewritten to the confirmed fields in the application-forms slice.
- 2026-10-05 (working-tree implementation): The confirmed application form/API, localized Admin inbox, Admin dashboard link, application detail page, review/reject/approve controls, one-time credentials panel, profile provisioning service, fake messaging provider, Jest setup, and initial tests are present. `webapp` typecheck and ESLint pass. The Phase 2 migration has not been applied. Jest still has an approval timeout, validation expectation failures, an empty request test file, and open async handles; integration is not complete.
- 2026-10-06 reconciliation: Phase 2 remains In Progress. The working-tree application/provisioning slice is not the complete educational-management phase; profile CRUD, relationship management, migration execution, and integration/concurrency verification remain open. Supervisor access is limited to operational review/provisioning and cannot expose or mutate financial data.
- 2026-10-06 verification: the application validation and request helper tests pass, and the full suite passes 33/33 after fixing honeypot parsing and the long-running concurrency test timeout. Profile CRUD, migration execution, and real-Postgres integration coverage remain open.
- 2026-10-06 database verification: the confirmed development database reset applied the Phase 2 profile migration successfully. Base/demo seeds now provide namespaced accounts, linked guardian/student/teacher profiles, subjects, and an application; CRUD surfaces and broader relationship/authorization integration coverage remain open.
- 2026-10-06 dashboard data pass: Admin, Teacher, Student, Guardian, and Supervisor role pages now perform server-side Prisma fetches scoped to the authenticated academy/user and display the available profile, subject, application, subscription, and session data. Unsupported report/homework/payroll UI is not faked; it remains gated by the missing Phase 5/6 models.
- 2026-10-06 control-surface pass: the internal `ADMIN` role is presented as SuperAdmin in the UI. SuperAdmin can create and activate/deactivate Admin and Supervisor accounts through an academy-scoped API/UI with self-lockout and last-active-SuperAdmin guards. The proxy now allows Supervisor access to the existing operational `/admin/applications` routes, fixing dashboard action links. Dashboard status colors and metric cards use centralized CSS tokens; final palette can be adjusted in one place.
- 2026-10-06 subject CRUD slice: added Zod-validated, academy-scoped Subject create/update/activation APIs and the localized `/admin/subjects` UI. Existing subject uniqueness is surfaced as a 409 conflict, and deactivation is used instead of destructive deletion.
- 2026-10-06 profile and relationship slice: added academy-scoped Student, Guardian, and Teacher create/list/update/activation APIs and pages; guarded Guardian–Student linking; duplicate-protected Teacher–Subject assignment with UI; and SessionStudent enrollment APIs with academy, subject, and unique-pair safeguards. Enrollment still needs a dedicated management UI, and database-backed authorization tests remain.
- 2026-10-06 enrollment management slice: added a dedicated `/admin/enrollments` page with server-side academy-scoped sessions/students, add/remove actions, current enrollment lists, and Supervisor route access. Duplicate and subject/teacher safeguards remain enforced by the existing API. Database-backed relationship and authorization tests remain.
- 2026-10-06 Phase 2 closure: owner requested completion without adding database-backed tests. All implementation and operational scope is complete; tests are deferred to the testing/launch workstream and are not represented as a blocker for this phase.
- 2026-10-06 Supervisor boundary correction: Supervisor is operational-only and has no access to application list, review, approval, rejection, or provisioning routes; those remain Admin-only.
- 2026-10-10 Step-0 review (read-only; scheduling-assignments plan documented, nothing implemented yet — migration and code await owner approval):
  - [VERIFIED] Teacher application approval **does** create `TeacherSubject` rows from the application's `subjects[]` inside the same transaction (`lib/provisioning.ts` resolves the subjects and `createMany`s them). The reported "Fatima Ahmed not linked to Quran" 409 does not match the current database: the teacher فاطمة احمد (username `sosa_mahmou_teacher`, teacher profile `99db2a5d-cfc4-4555-ad81-c1bdae144582`) has three `teacher_subjects` rows — Quran (`demo-quran`, row `0bc5e153-b84f-4066-96ec-0092a9d5bee1`), English (`demo-english`, row `97b1899d-4c73-41bb-8041-e280e6cb79b0`), and Arabic (`demo-arabic`, row `56287369-7db2-4335-9527-4716c6f24fef`), all assigned at her approval time (2026-10-10T14:37:35Z). The observed 409 therefore came from another check in `POST /api/sessions` — the merged `SESSION_PARTICIPANTS_INVALID` (student missing/inactive or any subject/teacher mismatch) or `INSUFFICIENT_SESSION_CREDIT` (the student `sosamahmoud` has no subscription, so any booking with her returns 409). The scheduling plan (phase-03) splits these into precise error codes.
  - [DECIDED — owner 2026-10-10] `StudentSubject` is created automatically on student/guardian application approval (same transaction, idempotent, unique per pair); teacher selection during approval is optional and creates the first `StudentTeacherAssignment` when chosen; otherwise the student appears in "Needs Teacher".
  - [DECIDED — owner 2026-10-10] Only Admin/Supervisor manage `StudentTeacherAssignment` (create / terminate / list, academy-scoped); scheduling overrides for a missing assignment are Admin/Supervisor-only with a required reason, logged on the created session.
  - [PLAN — awaiting owner approval for migrations/code]: new tables `student_subjects` + `student_teacher_assignments` (schema in `database-schema.md` §8.1/§8.2, including partial unique, composite FK to `teacher_subjects`, and RESTRICT deletes). The StudentSubject backfill from existing rosters is a separate statement, proposed rows shown to the owner (not inside the migration, applied only on explicit instruction); no assignment backfill.
