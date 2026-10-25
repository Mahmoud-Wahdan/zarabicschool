# Phase 4 — Live Learning (Zoom)

## Goal

Zoom integration for live sessions. (CONTEXT.md §13, Phase 4; §6 for full details.)

Implement the small manual-link experience: Admin edits the pasted Zoom link, and authorized teachers/students open it through a safe redirect.

## Status

**Implementation complete (2026-10-13) — pending owner steps.** All gap items are built and
verified (validate/typecheck/lint/12 suites × 149 tests/build green; baseline 10/111 protected).
The core redirect, URL validation, and host-link filtering were built and tested inside Phase 3
(see `review-before-phase-04.md`); this phase added the join time window, click-log failure
isolation, join rate limiting, per-session audited link editing (API + UI), series
"apply link to upcoming" with audit, the same-link overlap warning, and the role session UIs
completed against the checklist (i18n, no raw enums, window-aware buttons, teacher today-view
with per-student Zoom button, loading/error states). CLOSING BLOCKERS (owner): apply migration
`20261012000000_phase4_link_audit`, then run the manual test — the audit assertions and audit
writes activate only after the migration lands.

## Proposed approach

1. **Manual link management:** Admin edits the session link or recurrence copy.
2. **Session Experience (External Zoom Link):**
   - Display a private "Join Zoom" button/link for the assigned participant.
   - Open the Zoom desktop app, native mobile app, or Zoom browser experience externally.
   - Return the participant to the platform after the meeting for the teacher report flow.
3. **Optional click evidence:** A redirect logs session/user/time only, never the URL. KEPT (CONTEXT §6 safeguard; not optional for this build).

Delivery stage: Stage 2.

## Acceptance criteria

- Authorized users can open the correct link on desktop and mobile; Admin can edit it per session.
- The join button/redirect works only from 15 minutes before the scheduled start until the scheduled end (Admin/Supervisor exempt); the 15 is a config constant.
- Students/guardians NEVER receive the host link; host link only Admin, Supervisor, assigned teacher (server-enforced).
- A failed click-log insert never blocks the redirect.
- An apply-link action on a series touches only future, non-cancelled sessions.
- Two overlapping sessions sharing a join link produce a WARNING (never a block) at link-save time and in the admin list.
- Link changes write an audit entry WITHOUT the link value.

## Frontend

Routes: role session lists with a `Join Zoom` button (teacher: today's classes with a Zoom
button beside each student), `/admin/sessions` per-session link editor + series apply-link
action + overlap warnings. Loading, empty, error, mobile, and RTL states are required.

## Backend

- `PATCH /api/sessions/:id/link` (dedicated, audited) — Admin/Supervisor only, shared validator.
- `PATCH /api/sessions/recurrences/:id/link` (apply to upcoming) — Admin/Supervisor only.
- `GET /api/sessions/:id/join` (exists) — gains the time window, a per-user rate limit,
  click-log failure isolation, and an optional `?host=1` variant for the assigned
  teacher/Admin/Supervisor (404 for students/guardians — no existence leak).
- Validate URLs with the shared `lib/validation/zoom-url.ts`; return 400/401/403/404/409; never echo links.

## Database

No change to `Sessions`/`SessionJoinClicks`. NEW (pending owner-applied migration
`20261012_phase4_link_audit`): `SessionLinkAudits` — append-only audit rows for link changes
`(id, academy_id, series_id?, session_id?, changed_by_id, source SESSION|SERIES,
join_url_changed, host_url_changed, created_at)` — NEVER the URL value. Not applied by the
agent; the owner applies it (Phase 3 pattern). Until applied, the audit tests self-skip with a
visible "pending migration" reason.

## Auth & Authorization

| Role | Edit link | Open assigned link | View unrelated link | Host link |
|---|---:|---:|---:|---:|
| Admin | Yes | Yes (any time) | Yes | Yes |
| Supervisor | Yes | Yes (any time) | Yes | Yes |
| Teacher | No | Assigned only, in window | No | Assigned session only |
| Student/Guardian | No | Authorized only, in window | No | Never (404) |

Enforced on the server. Teacher cannot mutate sessions (request-only) — unchanged.

## Security

Do not log URLs or query parameters; authorize before redirect; validate external URL scheme/host policy; rate-limit redirects (per-user 30/min on top of the global proxy limiter); never expose host links to students.

## Transactions & failure handling

Link edits and series apply run in one transaction each (link rows + rule JSON + audit rows).
A failed optional click insert must not prevent a valid redirect, and must not disclose the link in an error.
Overlaps WARN, never block (free Zoom = 40-minute limit, one meeting at a time).

## Tests

Database-backed (real dev DB): redirect authorization matrix (assigned teacher, other teacher,
enrolled student, non-enrolled student, guardian of enrolled child, other guardian, Admin,
Supervisor, anonymous), host variant (assigned teacher/Admin allowed; student/guardian/other
teacher 404), time window (before/inside/after; Admin/Supervisor exempt), click logged per
click with no URL column and click-insert failure not blocking, invalid stored links rejected
(http, javascript:, overlong) at the redirect, per-session link PATCH (permissions, validation,
immutability, audit row without the link), apply-to-upcoming touches only future non-cancelled
sessions + updates the rule JSON, overlap warning returned without blocking, no link in
console output / `lastError`. Unit: the pure overlap helper.

## Learning checkpoint

- Why must authorization happen before issuing a redirect?
- Why must the host link be filtered on the server and not only hidden in the UI?

## Open decisions

- ~~Merge this small phase into Phase 3 or Phase 5.~~ Decided: standalone closure now.
- ~~Store host link and retain optional click logging.~~ CONFIRMED: host link stored (Admin/Supervisor/assigned teacher only), click logging KEPT.
- OPEN (for the owner, 2026-10-12): migration `20261012000000_phase4_link_audit`
  (SessionLinkAudits table, raw-SQL `source` CHECK, ON DELETE RESTRICT — deliberately NO
  append-only trigger; see database-schema.md §11) is generated but NOT applied — apply with
  `npx prisma migrate deploy` from `webapp/` (DIRECT_URL). Until then, `lib/scheduling/link-audit.ts`
  skips audit writes with a visible warning, and the audit test assertions deactivate with a
  `[phase4-test] PENDING MIGRATION` console notice (Jest cannot skip dynamically mid-test).
- OPEN (for the owner, 2026-10-12): creation-time overlap warnings (POST /api/sessions,
  recurrences) were NOT added to avoid touching closed Phase 3 routes; the warning appears at
  link-save time and in the admin list. Extend to creation in a later phase if wanted.
- RESOLVED (2026-10-13, by tests): the review classified admin/supervisor joins as untested;
  the new matrix proved they had been silently broken since Phase 3 (`OR: [{}]` matches nothing
  in Prisma's query compiler). Fixed with the list route's top-level conditional-spread pattern.

## Deferred / Post-MVP

- [DEFERRED] Future Zoom API verification layer.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [x] [exists, Phase 3] Authorized join redirect + click logging + host-link filtering + shared Zoom validation (tests: scenario 11, zoom-url suite, e2e)
- [x] Join time window (15-minute config constant, Admin/Supervisor exempt) in the redirect + window-aware UI buttons
- [x] Click-log failure isolation (failed insert never blocks the redirect) + per-user join rate limit
- [x] Host-link join variant (`?host=1`) for the assigned teacher/Admin/Supervisor (server-enforced)
- [x] Dedicated per-session link endpoint `PATCH /api/sessions/:id/link` (audited; general PATCH audited too)
- [x] Series action "apply link to all upcoming sessions" (future, non-cancelled only; rule JSON updated so worker weeks inherit) + per-session audit entries
- [x] Overlap warning at link-save time + in the admin list (warn, never block)
- [x] Role session UIs: teacher today's classes with Zoom button beside each student; student/guardian window-aware join; admin/supervisor link fields + series apply + localized statuses; loading/error states; i18n (ar/en), RTL, mobile
- [x] Tests for every gap item; suites re-run (10/111 baseline → 12 suites / 149 tests green)

## Execution log (updated as soon as real work happens)

### 2026-10-06 reconciliation

- Phase 4 remains Not Started. Manual-link editing, authorized join redirect, private-link access checks, and optional click-evidence logging are not implemented.
- Any click evidence remains optional audit data only; it cannot determine attendance, report outcomes, or teacher pay.

### 2026-10-12 gap review (see review-before-phase-04.md)

- Verified against the code: join redirect, click logging (model + insert), host-link
  filtering, and URL validation are DONE+TESTED from Phase 3. PARTIAL/MISSING: time window,
  click-failure isolation, per-endpoint rate limit, dedicated audited link endpoint + UI,
  series apply-link + audit, overlap warning, role-UI checklist items. No High findings.
- Plan recorded above; audit table requires a migration (owner applies — OPEN).

### 2026-10-12/13 implementation — built and verified

- [built] `lib/config/session-join.ts` (15-minute window constant + `joinWindowState`),
  `lib/scheduling/link-overlap.ts` (pure pairwise same-link overlap helper),
  `lib/scheduling/link-audit.ts` (URL-less audit writer + pending-migration gate).
- [built] Join route: 15-minute window (operators exempt), 30/min per-user rate limit,
  click-insert try/catch (failure logged without the link, never blocks), `?host=1` variant
  (assigned teacher/Admin/Supervisor; students/guardians get the generic 404).
- [built] `PATCH /api/sessions/[id]/link` and `PATCH /api/sessions/recurrences/[id]/link`
  (both validate with the shared validator, audit in the same transaction, and return
  `ZOOM_LINK_OVERLAP` warnings without blocking; the series route updates only future,
  non-cancelled sessions and the recurrence rule so worker weeks inherit the new links).
- [built] General `PATCH /api/sessions/[id]` now writes the same audit entry for link changes.
- [built] Admin sessions UI: localized hero/statuses/types, per-session link editor,
  series apply-link form, overlap warning chips (server-computed `findLinkOverlaps`).
- [built] Role session pages rebuilt with next-intl: teacher today's classes (viewer-timezone
  day via `wallClockInputToUtc`) with a Zoom button beside each student + host-start button;
  student and per-child guardian views; `SessionJoinLink` renders a disabled control with a
  localized hint outside the window so users never land on the JSON 403; loading.tsx +
  error.tsx for all three routes; `common.retry` key added.
- [built] `SessionLinkAudit` model + migration `20261012000000_phase4_link_audit`
  (raw-SQL `source` CHECK, ON DELETE RESTRICT, NO append-only trigger — database-schema.md
  §11) — NOT applied by the agent; the owner applies it.
- [built] Gated audit cleanup in `__tests__/helpers/session-fixtures.ts` and
  `prisma/clear-demo.ts` so audit rows stop blocking demo/session deletes once applied,
  without breaking pre-migration runs.
- [tested] `__tests__/api/phase4-live-links.test.ts` (31 DB-backed tests: redirect matrix
  incl. anonymous/foreign-academy/other-guardian, window before/inside/after + operator
  exemption, click row-per-click with URL-absence assertions, click-insert failure isolation,
  30/min rate limit, javascript:/overlong stored-link 409s, full host-variant matrix, link-PATCH
  permissions/validation/immutability/audit, series apply-to-upcoming + rule inheritance +
  past/cancelled exclusion, overlap warning non-blocking, worker lastError link-absence) and
  `__tests__/scheduling/link-overlap.test.ts` (7 unit tests).
- [found+fixed by tests] The new admin/supervisor join assertions exposed a latent Phase 3
  bug: `OR: [...(operator ? [{}] : [])]` matches nothing in Prisma's query compiler, so
  operator joins had always returned 404. Fixed in the join route with the list route's
  top-level conditional-spread scoping; the dead `excludeId` param was removed from
  `findLinkOverlaps` at the same time.
- [reconciled] `sessions.test.ts` scenario 11 moved its join-eligible sessions into the
  window (direct DB start/end updates, commented) so the scenario keeps testing the
  authorization matrix under the CONFIRMED window contract; window behavior itself is covered
  by the Phase 4 suite.
- [verified 2026-10-13, from `webapp/`] `npx prisma validate` valid; `npm run typecheck`
  clean; `npm run lint` clean; `npm test` 12 suites / 149 tests green (baseline 10/111 —
  +38 tests); `npm run build` compiles successfully with the new routes in the manifest.
  Migration intentionally NOT applied (`prisma migrate status` shows it pending — owner step).
