# Expanded Operational Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Admin/Supervisor student, guardian, and teacher profile tables with operational relationships in Arabic and English, supporting Light and Dark themes.

**Architecture:** Extend the existing profile read API as the single academy-scoped read model, preserving all existing create/update behavior. Extend the existing shared `ProfilesPanel` so each role gets role-specific summary columns and an accessible native `<details>` disclosure; no relationship write behavior moves into this surface.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma, next-intl, Tailwind CSS, existing `z-*` design tokens and status components.

**Spec:** `docs/superpowers/specs/2026-11-23-expanded-profile-relations-design.md`

## Global Constraints

- RTL Arabic is the default; English must remain complete.
- Light and Dark modes use the existing app tokens and must not define an alternate palette.
- Every relationship query remains filtered by the authenticated user's `academyId`.
- Only active assignments are shown in relationship summaries.
- A student's adult/minor status is based on `User.dateOfBirth` and remains `age >= 18` in UTC date terms.
- A guardian detail must show linked children, with each child's adult/minor status and active assignments.
- A teacher detail must show taught subjects and each subject's assigned active students.
- The UI uses semantic table markup, native disclosures, visible labels on mobile, keyboard focus, and no page-level horizontal overflow.
- Existing create, activate/deactivate, approve-teacher, payment, and announcement behavior must remain unchanged.

## Review Focus

- Empty relationships: Student with no guardian or assignments, guardian with no children, and teacher with no subjects must display explicit empty states, not blank or misleading values. Test in each API and row mapper task.
- Birth-date edge: DOB exactly on/before today's UTC date must be considered adult when the 18th birthday has arrived. Test `calculateAdultStatus` with birthday and day-before-birthday values.
- Active-only assignment scope: ended assignments must never appear in relationship summaries. Test the API selection and mapper count.
- Academy isolation: a guardian/subject/student from another academy must never enter the response. Test the route query shape or an academy-scoped helper.
- Mobile and keyboard access: relationship controls must expose an accessible name and work with Enter/Space and no viewport overflow. Verify in Playwright or a browser snapshot.

---

### Task 1: Extend the Profile Read API Contract

**Files:**
- Modify: `webapp/app/api/admin/profiles/route.ts`
- Create: `webapp/lib/admin/profile-relations.ts`
- Test: `webapp/tests/profile-relations.test.ts`

**Interfaces:**
- Produces `type StudentRelationSummary = { id: string; displayName: string; isAdult: boolean; assignments: { subjectId: string; subjectNameAr: string; subjectNameEn: string; teacherName: string }[] }`
- Produces `type ProfileRelationRow` with `dateOfBirth: string | null`, `guardian`, `activeAssignments`, `students`, `subjects`, and `studentsBySubject` as appropriate.
- Consumes existing `User`, `Student`, `Guardian`, `Teacher`, `Subject`, `StudentSubject`, `StudentTeacherAssignment`, and `TeacherSubject` Prisma models.

- [ ] **Step 1: Write failing tests for role-specific relationship mapping.**

Add tests that assert:
1. A student gets its guardian name/relationship and only active assignments.
2. A guardian gets linked children and no child from outside the supplied relation set.
3. A teacher gets subject names and active students grouped by subject.
4. Missing date of birth returns `dateOfBirth: null` and `isAdult` is driven by the existing stored `Student.isAdult` where DOB is absent.

- [ ] **Step 2: Run the test and confirm it fails because the mapping module is absent.**

Run: `cd webapp && npx tsx --test tests/profile-relations.test.ts`
Expected: module-not-found failure for `../lib/admin/profile-relations`.

- [ ] **Step 3: Create `webapp/lib/admin/profile-relations.ts` with pure mapping helpers.**

Define a function that accepts raw academy-scoped Prisma rows and returns the role-specific relation fields already declared by the test. Map only assignments where `status === "ACTIVE"`; keep subject names in `nameAr` and `nameEn`.

- [ ] **Step 4: Extend `GET /api/admin/profiles` to select named relations.**

For students, include `dateOfBirth` and `studentProfile.guardian.user.displayName/phone/relationship`, plus `studentProfile.assignments` with student name not needed, `teacher.user.displayName`, `subject.nameAr/nameEn`, filtering `status: "ACTIVE"`.

For guardians, include `guardianProfile.students` with `user.displayName/dateOfBirth/isAdult`, and for each student include active assignments with teacher and subject names.

For teachers, include `teacherProfile.subjects.subject`, and `teacherProfile.assignments` filtered `status: "ACTIVE"`, each with `student.user.displayName` and `subject.nameAr/nameEn`; also keep existing `teacherFlags` and approval fields.

Every Prisma relation remains under `where.academyId = user.academyId` as applicable.

- [ ] **Step 5: Run the mapping test and verify it passes.**

Run: `cd webapp && npx tsx --test tests/profile-relations.test.ts`
Expected: PASS for the four mapping cases.

- [ ] **Step 6: Run TypeScript validation.**

Run: `cd webapp && npm run typecheck`
Expected: no TypeScript errors.

### Task 2: Expand the Student Profile Table

**Files:**
- Modify: `webapp/app/[locale]/admin/profiles-panel.tsx`
- Modify: `webapp/messages/ar.json`
- Modify: `webapp/messages/en.json`
- Test: `webapp/e2e/profile-relations.spec.ts`

**Interfaces:**
- Consumes `studentProfile.dateOfBirth`, `guardian`, `activeAssignments`, and `financeStatus` from the existing profile API.
- Produces role-specific summary cells and an expanded native details block.

- [ ] **Step 1: Write or add an end-to-end test that opens the student profile page and expands a row.**

The test must assert:
1. DOB/age/adult or minor text is visible.
2. Guardian name and relationship are visible in summary or disclosure.
3. An active subject and teacher name are visible in the disclosure.
4. The details control has an accessible label and can be toggled with keyboard interaction.

- [ ] **Step 2: Run the test and confirm the rich relationship content is currently missing.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts --grep "student"`
Expected: assertion failure for missing DOB/guardian/details content.

- [ ] **Step 3: Add student row types and locale keys.**

Add keys under `management.form` for DOB, age, adult, minor, guardian, no guardian, relationship, subjects, teachers, details, active assignments, and no assignments in both JSON files.

- [ ] **Step 4: Replace the student table body with the role-specific summary and native disclosure.**

Keep existing account name, username, phone, finance, status, announcements, and action columns. Add DOB/age and guardian/relationship columns. Show a compact subject/teacher summary and use `<details><summary>` for the complete relationship list.

- [ ] **Step 5: Run the student Playwright test and TypeScript validation.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts --grep "student" && npm run typecheck`
Expected: student test passes and TypeScript reports no errors.

### Task 3: Expand the Guardian Profile Table

**Files:**
- Modify: `webapp/app/[locale]/admin/profiles-panel.tsx`
- Modify: `webapp/messages/ar.json`
- Modify: `webapp/messages/en.json`
- Test: `webapp/e2e/profile-relations.spec.ts`

- [ ] **Step 1: Add a failing guardian E2E assertion for linked children.**

Assert that a guardian row shows relationship, a linked-child count, and expanding details shows each child name, adult/minor status, subject, and teacher.

- [ ] **Step 2: Run and confirm the guardian assertion fails before implementation.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts --grep "guardian"`
Expected: missing linked-child relationship content.

- [ ] **Step 3: Implement the guardian role-specific table.**

Show relationship, linked-child count, account status, and details. In the details block list each linked child and its subject/teacher assignments; show an explicit no-children empty state.

- [ ] **Step 4: Run the guardian test and typecheck.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts --grep "guardian" && npm run typecheck`
Expected: PASS.

### Task 4: Expand the Teacher Profile Table

**Files:**
- Modify: `webapp/app/[locale]/admin/profiles-panel.tsx`
- Modify: `webapp/messages/ar.json`
- Modify: `webapp/messages/en.json`
- Test: `webapp/e2e/profile-relations.spec.ts`

- [ ] **Step 1: Add a failing teacher E2E assertion for subjects and assigned students.**

Assert that a teacher row shows subject count and that expanded details group active students by subject.

- [ ] **Step 2: Run and confirm the teacher assertion fails before implementation.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts --grep "teacher"`
Expected: missing subject/student relationship content.

- [ ] **Step 3: Implement the teacher role-specific table.**

Keep approval, activation, flags, and existing hourly-rate controls unchanged. Add subject count and a details block that lists each subject and the active assigned students; show no-subjects/no-students empty states.

- [ ] **Step 4: Run the teacher test and typecheck.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts --grep "teacher" && npm run typecheck`
Expected: PASS.

### Task 5: Responsive Light/Dark Verification

**Files:**
- Modify: `webapp/app/[locale]/admin/profiles-panel.tsx` if responsive defects are found
- Test: `webapp/e2e/profile-relations.spec.ts`

- [ ] **Step 1: Add a viewport test for desktop and mobile in both themes.**

Test 1440x900 and 390x844 in Arabic and English, with theme switched by existing `data-theme="dark"` behavior.

- [ ] **Step 2: Verify the existing table fits or transforms into stacked labeled rows without document overflow.**

Assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth` and that relationship summaries remain visible or are reachable through details.

- [ ] **Step 3: Run the complete profile-relations E2E file and typecheck.**

Run: `cd webapp && npx playwright test e2e/profile-relations.spec.ts && npm run typecheck`
Expected: all profile relationship cases pass.

- [ ] **Step 4: Perform the Impeccable mechanical detector once on changed UI files.**

Run: `G:\programming\zarabicschool\.claude\skills\impeccable\scripts\impeccable.cmd detect --json G:\programming\zarabicschool\webapp\app\[locale]\admin\profiles-panel.tsx`
Expected: no blocking accessibility or layout findings, or document any findings that require a follow-up design decision.
