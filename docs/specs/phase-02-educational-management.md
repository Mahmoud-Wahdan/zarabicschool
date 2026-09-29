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
