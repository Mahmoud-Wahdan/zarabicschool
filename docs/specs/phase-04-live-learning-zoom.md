# Phase 4 — Live Learning (Zoom)

## Goal

Zoom integration for live sessions. (CONTEXT.md §13, Phase 4; §6 for full details.)

Implement the small manual-link experience: Admin edits the pasted Zoom link, and authorized teachers/students open it through a safe redirect.

## Status

**In Progress (2026-10-12).** The core redirect, URL validation, and host-link filtering were
built and tested inside Phase 3 (see `review-before-phase-04.md`). This phase builds ONLY the
verified gaps: join time window, click-log failure isolation, join rate limiting, per-session
audited link editing (API + UI), series "apply link to upcoming" action with audit, same-link
overlap warning, and the role session UIs completed against the checklist (i18n, no raw enums,
window-aware buttons, teacher today-view with per-student Zoom button, loading/error states).

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
- OPEN (for the owner, 2026-10-12): migration `20261012_phase4_link_audit` (SessionLinkAudits
  table + append-only trigger) is generated but NOT applied — apply with
  `npx prisma migrate deploy` (or `db:migrate`); until then the audit tests self-skip.
- OPEN (for the owner, 2026-10-12): creation-time overlap warnings (POST /api/sessions,
  recurrences) were NOT added to avoid touching closed Phase 3 routes; the warning appears at
  link-save time and in the admin list. Extend to creation in a later phase if wanted.

## Deferred / Post-MVP

- [DEFERRED] Future Zoom API verification layer.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [x] [exists, Phase 3] Authorized join redirect + click logging + host-link filtering + shared Zoom validation (tests: scenario 11, zoom-url suite, e2e)
- [ ] Join time window (15-minute config constant, Admin/Supervisor exempt) in the redirect + window-aware UI buttons
- [ ] Click-log failure isolation (failed insert never blocks the redirect) + per-user join rate limit
- [ ] Host-link join variant (`?host=1`) for the assigned teacher/Admin/Supervisor (server-enforced)
- [ ] Dedicated per-session link endpoint `PATCH /api/sessions/:id/link` (audited; general PATCH audited too)
- [ ] Series action "apply link to all upcoming sessions" (future, non-cancelled only; rule JSON updated so worker weeks inherit) + per-session audit entries
- [ ] Overlap warning at link-save time + in the admin list (warn, never block)
- [ ] Role session UIs: teacher today's classes with Zoom button beside each student; student/guardian window-aware join; admin/supervisor link fields + series apply + localized statuses; loading/error states; i18n (ar/en), RTL, mobile
- [ ] Tests for every gap item; suites re-run (count must not drop below the 10/111 baseline)

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

### 2026-10-12 implementation (in progress — results recorded below when verified)

- [planned] `lib/config/session-join.ts` (JOIN window constant), `lib/scheduling/link-overlap.ts`
  (pure overlap helper), `lib/scheduling/link-audit.ts` (audit writer + migration gate).
- [planned] Join route: window + per-user rate limit + click try/catch + `?host=1` variant.
- [planned] `PATCH /api/sessions/[id]/link` and `PATCH /api/sessions/recurrences/[id]/link`
  (both audited in the same transaction; overlap warnings returned, never blocking).
- [planned] Admin sessions UI: per-session link editor, series apply-link, overlap warnings,
  localized statuses; role session pages rebuilt (i18n, window-aware buttons, teacher
  today-view with per-student Zoom buttons, per-child guardian view, loading/error routes).
- [planned] `SessionLinkAudit` model + migration (append-only trigger, ON DELETE RESTRICT) —
  NOT applied by the agent; audit tests self-skip until the owner applies it.
- [planned] `__tests__/api/phase4-live-links.test.ts` (DB-backed) + unit test for the overlap
  helper; full suite re-run.
