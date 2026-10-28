# S-02 — Teacher approval (D9, D38) and a minor needs a guardian (D10)

> Plan row: `phase-09-plan.md` S-02. Skills: superpowers:test-driven-development, impeccable (detector), superpowers:verification-before-completion.

## Design (14af707, a6504f9)
- SQL S-2 (`20261028100000_teacher_approval_status`, teachers, not financial; applied by the agent with the owner's permission): `approval_status` PENDING|APPROVED (existing APPROVED), `approved_by`, `approved_at`.
- The Admin adds a teacher WITH a rate (APPROVED, a `teacher_rates` row). A Supervisor adds one WITHOUT a rate: PENDING, user inactive (cannot sign in, `lib/auth.ts`), Admin notice `TEACHER_PENDING_APPROVAL` (ids only). A Supervisor sending a rate is 403.
- `POST /api/admin/teachers/:id/approve` (Admin, same-origin): rate, APPROVED, active, a fresh temporary password sent with the messaging provider (never stored plain, logged or returned; a failed delivery leaves a redacted CREDENTIALS job).
- `resolveParticipants` (every scheduling path: single, series, replacement) and assignments refuse a PENDING teacher. The profile PATCH cannot activate a PENDING teacher (409; found while building S-03, TCH-07).
- D10: a minor student without a guardian is refused (GUARDIAN_REQUIRED). The form gets an "adult who pays for themself" option, Admin rate fields, a pending badge and an inline Approve.
- Applications approval stays Admin-only and unchanged (no rate there yet; rates page as before).

## Log
- 2026-10-28: TCH-01..07, STU-G-01..02 (red first); affected suites 276/276; Impeccable detector clean.
