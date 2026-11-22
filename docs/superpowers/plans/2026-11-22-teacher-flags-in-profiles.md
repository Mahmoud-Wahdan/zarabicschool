# Teacher Flags in Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show existing automated teacher flags to Admins and Supervisors in teacher management.

**Architecture:** Extend the academy-scoped teacher profile list response with each teacher's stored flags and minimal session/month context. Render them in a read-only, localized disclosure in the teacher table; keep student and guardian lists unchanged.

**Tech Stack:** Next.js App Router, Prisma, React, next-intl, Jest.

**Spec:** `docs/superpowers/specs/2026-11-22-teacher-flags-in-profiles-design.md`

## Global Constraints

- Preserve existing `ADMIN` and `SUPERVISOR` route access and academy scoping.
- Flags are historical records; do not imply they are active, unresolved, or editable.
- Do not add flags for students or guardians or alter worker behavior.
- Support Arabic RTL and English labels.

## Review Focus

- Cross-academy records must never be returned: pin with a foreign-academy flag in the API test.
- Students and guardians must not receive teacher flags: assert both profile types return no flag data.
- A late-report flag can have nullable session context at the TypeScript level: render a safe fallback.
- Monthly flags carry a month key, not a session date: render the correct month context.
- Many flags must not stretch table rows indefinitely: use a disclosure with a count summary.

---

### Task 1: Academy-scoped API data

**Files:**
- Modify: `webapp/app/api/admin/profiles/route.ts`
- Create: `webapp/tests/api/admin-profiles.test.ts`

**Interfaces:**
- GET `?type=teacher` adds `teacherFlags` to each `teacherProfile`, with `id`, `flagType`, `createdAt`, `monthKey`, and optional session `scheduledEnd`, `timezone`, and subject names.
- GET `?type=student` and `?type=guardian` keep their existing response shape.

**Ruling:** Render a late-report date in the session's timezone — the same instant may be a different calendar day for the viewer, and the flag refers to the session's day.

- [ ] **Step 1: Write failing API tests**
  - Test Admin and Supervisor can receive both flag types for an in-academy teacher.
  - Test a foreign-academy teacher flag is absent.
  - Test student and guardian responses do not include teacher flags.
- [ ] **Step 2: Run the focused API test and verify it fails because teacher flags are absent.**
  - Run: `npm test -- tests/api/admin-profiles.test.ts --runInBand`
- [ ] **Step 3: Extend only the teacher profile selection**
  - Query flags with `academyId: user.academyId`, newest first, and select only display context.
- [ ] **Step 4: Run the focused API test and verify it passes.**

### Task 2: Localized profile display

**Files:**
- Create: `webapp/app/[locale]/admin/teacher-flags-cell.tsx`
- Modify: `webapp/app/[locale]/admin/profiles-panel.tsx`
- Modify: `webapp/messages/ar.json`
- Modify: `webapp/messages/en.json`
- Create: `webapp/tests/lib/teacher-flags-cell.test.tsx`

**Interfaces:**
- `TeacherFlagsCell` consumes the selected teacher flag data and renders a count summary with a native disclosure containing each flag's translated type and session/month context.
- The profile table renders the flags column only when `type === "teacher"`.

- [ ] **Step 1: Write rendering tests**
  - Assert Arabic and English labels for both flag types and their date/month context.
  - Assert the empty state does not show a flagged count.
- [ ] **Step 2: Run the focused rendering test and verify it fails.**
  - Run: `npm test -- tests/lib/teacher-flags-cell.test.tsx --runInBand`
- [ ] **Step 3: Implement the translated disclosure and add it to teacher rows only.**
- [ ] **Step 4: Run focused rendering and API tests, then `npm run typecheck` and scoped ESLint.**
- [ ] **Step 5: Run the worker suites to ensure flag creation and persistence behavior is unchanged.**
