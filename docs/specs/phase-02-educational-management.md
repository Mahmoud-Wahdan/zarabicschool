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

- Exact fields for all three forms: BLOCKED until owner lists them.
- `TeacherRates` table versus teacher fields: BLOCKED until owner decides.
- Public intake in Phase 1 versus Phase 2.

## Deferred / Post-MVP

- [DEFERRED] SMS delivery, complex SaaS administration, and unrestricted self-service registration.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [ ] Add Prisma schema: `Guardians`, `Students`, `Teachers`, `Subjects`, `TeacherSubjects`
- [ ] Add Prisma schema: `Applications` (supporting Guardian, Student, Teacher applicant types)
- [ ] Run migrations
- [ ] Build public landing page application forms (3 tabs: Guardian, Student, Teacher)
- [ ] Build admin application inbox & review UI (validate, accept, reject)
- [ ] Build automated account provisioning flow on admin acceptance (User + profile + OpenWA WhatsApp credential dispatch)
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

(empty for now)
