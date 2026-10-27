# S-01 — Manual attendance resolution (D2, D36, D37, D46)

> Plan row: `phase-09-plan.md` S-01. Skills: superpowers:test-driven-development, superpowers:systematic-debugging (ledger CHECK finding), superpowers:verification-before-completion, modern-web-guidance (`forms`).

## Design
- `lib/attendance/resolution.ts`: one shared `plan()` for the preview and the write. Admin any time; Supervisor ≤ 7 days after the scheduled end; roster only; ended and not CANCELLED/MISSED; refused while a SUBMITTED/APPROVED report exists, after a settlement, or a second time.
  - ATTENDED: reservation CONSUMED + one SESSION_DEDUCTION (the reservation's package, else a package valid on the session date with free credit); **BLOCKED with NO_SESSIONS_LEFT** when there is none (owner, 2026-10-27).
  - STUDENT_ABSENT: reservation RELEASED, no ledger row.
  - One transaction, session row `FOR UPDATE`; append-only audit row; `ATTENDANCE_RESOLVED` notice to every Admin. Never payroll, never a report, never a session status change.
- Approval after a resolution (`settlement-seam.ts`, review route): only the teacher side; the resolution's attendance stands; a different outcome → `ATTENDANCE_RESOLUTION_MISMATCH` Admin flag.
- `GET/POST /api/sessions/:id/students/:studentId/attendance-resolution`: GET = the exact effect for the confirmation screen (no money); POST needs `confirm: true`.
- UI (session detail page): per student "Resolve attendance manually" → outcome + reason → effect (attendance, package effect, sessions left before → after, **teacher NOT credited**, a later report is still accepted) → confirm. Derived chips "Ended — teacher report pending" / "Attendance resolved manually — teacher report pending" (`lib/attendance/roster-state.ts`).

## Log
- 2026-10-27: migration 20261027120000 confirmed applied by the owner (migrate status up to date; table, 10 constraints, append-only trigger, 0 rows).
- 2026-10-27: ATT-01..11 written first (module missing). Finding: the 2026-10-26 ledger CHECK requires `report_id` on every SESSION_DEDUCTION, so the D36a deduction could not be written. The owner chose SQL S-1b (D46): migration file `20261027130000_subscription_ledger_manual_deduction` created, **not applied**. Until the owner applies it, ATT-01/04/07/10/11 fail on that CHECK; ATT-02/03/05/06/08/09 and the reports, settlement, payroll and layer-1 suites pass (61 tests, 56 green). eab5938.
