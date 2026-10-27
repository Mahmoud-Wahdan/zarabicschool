# S-04 — Join window setting + reminder with the platform link

> Plan row: `phase-09-plan.md` S-04. Decisions: D4, D26, D28 (OQ-4 + reminder answers, 2026-10-27). Skills: superpowers:test-driven-development, superpowers:verification-before-completion.

## Design
- **Setting:** AcademySettings key `join_window_minutes` (whole minutes 5–120, default 30 — `lib/config/session-join.ts`). Read by `lib/sessions/join-window.ts` (`getJoinWindowMinutes`; unset/invalid → default). No migration.
- **API:** `GET/PUT /api/admin/settings/join-window` — Admin only (Supervisor/teacher 403), `requireSameOrigin`, Zod int 5–120. PUT = one transaction: upsert the setting + re-time every PENDING `SESSION_REMINDER` of a SCHEDULED session whose start is still in the future to `start − window`; answers `{ minutes, retimedReminders }`. SENT/FAILED jobs and started sessions are untouched.
- **Who it applies to:** the join redirect (`/api/sessions/:id/join`) and the window-aware buttons on the teacher/student/guardian pages. Admin and Supervisor stay exempt (D26).
- **Reminder:** `enqueueSessionJobs` queues `SESSION_REMINDER` at `start − window` (replaces T−2h, D28) and `SESSION_START` at the start (unchanged). The worker reads the window once per academy per tick; inside the window the text carries the platform join URL (never zoom.us), before it says "opens N minutes before".
- **UI:** Admin-only card on `/admin/sessions` ("Join window"), ar/en, `role="status"` result line. The Supervisor never receives the setting.

## Checklist
- [x] JW-01..06 written first (suite failed: modules missing)
- [x] setting helper + Admin API + re-timing
- [x] join route + role pages + join button hint
- [x] reminder enqueue + worker text
- [x] old tests moved from 15 min / 2 h (Phase 4 window, sessions reschedule, JL-01)
- [x] tsc + lint clean; commit f7b544a

## Log
- 2026-10-27: JW-01..06 first (suite failed on the missing modules); then green 6/6 (one test fix: JW-04 left its reminders in the academy, which JW-05 then correctly re-timed — cleanup added). Affected suites: join-window, phase4-live-links, sessions, join-browser, late-start-and-monthly-flag, scheduling-worker, session-requests, late-report-chain = 8 suites / 95 tests green; owasp, same-origin-guard, edge-cases, layer1-full-cycle = 4 suites / 128 tests green (the sweeps include the new route). tsc 0, lint 0. Full suite not run.
