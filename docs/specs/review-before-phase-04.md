# Phase 4 review before implementation (2026-10-12)

> Purpose: verify what of Phase 4 (Live Learning via manual Zoom links) already exists in the
> closed Phase 3 work before building anything. The phase-04 spec said "Not Started"; the code
> is the truth and part of Phase 4 was already built inside Phase 3.
> Reviewer: coding agent (opencode). Read-only review — no code was changed for this document.

## Summary

The Phase 3 batches already delivered the core of Phase 4's backend: the authorized join
redirect with click logging, the shared Zoom URL format validator (wired into every write path),
and server-side host-link filtering in the list API, all with database-backed tests. What is
**missing** is: the join time window (15 minutes before start → scheduled end), per-endpoint
rate limiting on the join redirect, click-log failure isolation, a per-session link-edit
surface (API exists via the general PATCH, but no dedicated audited endpoint and no UI), the
series "apply link to upcoming sessions" action with an audit trail, the same-link overlap
warning, and the role session UIs are incomplete against the Phase 4 checklist (hardcoded
English, raw enum printing, no window awareness, no per-student Zoom button for the teacher).

No High findings (authorization, money, data integrity) were found. One Medium (click-insert
failure blocks the redirect — it is itself a Phase 4 gap item, so it is fixed as Phase 4 work,
not as a silent closed-work fix).

## Classification table

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Authorized join redirect (GET /api/sessions/[id]/join) | **DONE+TESTED (core) / PARTIAL (window, rate limit)** | `app/api/sessions/[id]/join/route.ts:7-34`: academy-scoped role matrix (Admin/Supervisor any session, assigned teacher, enrolled student, guardian of enrolled child), cancelled/non-SCHEDULED → 404 (no existence leak), legacy bad links → 409 `INVALID_ZOOM_URL` without echoing the link. Tested: `__tests__/api/sessions.test.ts:335-408` (scenario 11: student/guardian 307, unenrolled 404, cancelled 404, stored http link 409). **Missing**: 15-minute join window; assigned-teacher/other-teacher/Admin/Supervisor/anonymous/other-guardian joins untested; no dedicated rate limit (only the global proxy limiter, `proxy.ts:49-54`, 120 req/min/IP, which does run before the `/api/` early-return). |
| 2 | Join-click logging (SessionJoinClick) | **PARTIAL** | Model stores only `(session_id, user_id, clicked_at)` — no URL column (`prisma/schema.prisma`, `SessionJoinClick`). Row per click asserted in scenario 11 (`sessions.test.ts:368,374`). **Missing**: the awaited insert at `join/route.ts:33` is not failure-isolated — a failed insert blocks the redirect (the phase-04 spec requires the opposite); no failure-path test. |
| 3 | Host link never reaches students/guardians | **DONE+TESTED** | `app/api/sessions/route.ts:72-75` strips `zoomHostUrl` for STUDENT/GUARDIAN; teachers only receive rows scoped to their own sessions (`route.ts:54`). Join route selects only `zoomJoinUrl` (`join/route.ts:23`). Tested: `sessions.test.ts:347,355,362` (admin sees host, student/guardian don't) and `e2e/phase3.e2e.spec.ts:404-410`. Role UI pages render links only through the redirect (no raw link in HTML). |
| 4 | Zoom URL validation | **DONE+TESTED** | `lib/validation/zoom-url.ts`: https-only (rejects `http:`, `javascript:` via protocol check), parsed-hostname allowlist `zoom.us`/`*.zoom.us` (rejects lookalikes), trim, max 2000, no userinfo, no ports, path/meeting-id rules, generic reasons that never echo the link. Localized in UI: `messages/{ar,en}.json` `sessionsAdmin.zoom.reasons.*`. Wired into create/recurrence/replacement/PATCH (both links) and the join redirect. Tested: `__tests__/validation/zoom-url.test.ts` (18 unit tests) + `sessions.test.ts:748` (create+PATCH reject `INVALID_ZOOM_URL`). |
| 5 | Admin/Supervisor link editing per session | **PARTIAL** | API accepts link edits via the general `PATCH /api/sessions/[id]` (`app/api/sessions/[id]/route.ts:29-36`), ADMIN/SUPERVISOR only (server-side `requireApiRoles`), validated with the shared validator; teacher mutation → 403 (tested, scenario 10, `sessions.test.ts:294-306`). **Missing**: no dedicated audited link endpoint; no per-session link-edit UI in the admin sessions list; no audit entry for link changes. |
| 6 | Series "apply link to all upcoming" + audit | **MISSING** | No endpoint, no UI, no audit mechanism anywhere (checked `app/api/**`, `app/[locale]/admin/sessions/*`, `lib/schedules/series.ts`). Series rule JSON stores the links (`lib/schedules/series.ts:10-11`) and worker-continued weeks inherit them — an apply action must also update the rule. |
| 7 | Overlap warning (same join link + overlapping time) | **MISSING** | Nothing queries same-link overlaps; no warning in the admin list or save path. (CONTEXT §17: "the platform will warn when two overlapping sessions share the same join link".) |
| 8 | Join time window (T-15min → scheduled end; Admin/Supervisor always) | **MISSING** | The join route has no time check — any authorized user can open the link at any time; UI shows the button for every SCHEDULED session. No config constant for the 15 minutes. |
| 9 | UI per role | **PARTIAL** | Teacher/student/guardian session pages exist with working redirect buttons (`app/[locale]/{teacher,student,guardian}/sessions/page.tsx`) and the admin smart create forms have real-time link feedback (`session-management-panel.tsx:341-355`). **Gaps**: the three role pages are hardcoded English ("My sessions", "Open Zoom"), print raw enums (`session.status`, `session.sessionType`), always use `subject.nameEn`, have no window awareness, no loading/error route files, and the teacher has no "today's classes" view with a Zoom button beside each student (the dashboard's per-student buttons are report-only, `app/[locale]/teacher/page.tsx`). Admin/supervisor list prints raw status enums and has no link-edit UI. RTL is handled by the layout (`dir` per locale); the shared `formatSessionDateTime` Intl helper exists (`lib/schedules/display.ts`). |
| 10 | Links never in logs / NotificationLog / audit / errors | **DONE (by construction) / UNTESTED** | `NotificationJob` has no content column (schema); messages are composed in memory (`lib/worker/notifications.ts:33-52`) and the SESSION_START WhatsApp text carries the join link **by design** (CONTEXT §6, never persisted). Provider errors are generic (`openwa-provider.ts:26,29`); console logs carry user ids only (`fake-provider.ts`, `worker/notifications.ts:204-223`). Validation errors never echo the link (`zoom-url.ts` + route helpers). **No test asserts the absence** of links in logs/errors. |
| 11 | Test coverage of the above | **PARTIAL** | Covered: URL validation matrix (18), exposure matrix + join guards (scenario 11), https regression (R10), create/PATCH invalid links, e2e student host-link absence + unenrolled 404. **Not covered**: full redirect matrix (assigned teacher, other teacher, Admin, Supervisor, anonymous, other-guardian, cross-academy join), time window, click-insert failure, host-link join variant, apply-to-upcoming, overlap warning, no-link-in-log assertions. |

## Found in closed work (recorded, not silently fixed)

- **F1 (Medium)** — `app/api/sessions/[id]/join/route.ts:33`: the click-log insert is awaited
  inline with no failure isolation, so a failed insert blocks the redirect. The phase-04 spec
  explicitly requires the opposite ("a failed optional click insert must not prevent a valid
  redirect"). This is a Phase 4 gap item, so it is fixed as part of Phase 4 work.
- **F2 (Low)** — `app/[locale]/{teacher,student,guardian}/sessions/page.tsx` and
  `admin/sessions/page.tsx` hero: hardcoded English strings and raw enum values
  (`SCHEDULED`, `PRIVATE`) are printed in Arabic pages. Phase 4 item 9 covers this; fixed as
  gap work, listed as touched files.
- **F3 (Observation, no action)** — `GET /api/sessions` returns the raw `zoomJoinUrl` to
  students/guardians in the list JSON while the UI uses the authorized redirect. Policy allows
  students/guardians to see their own join link, so this is not a leak; recorded because the
  host-link equivalent IS filtered and tested.
- **F4 (Low)** — Teacher dashboard "today" section (`app/[locale]/teacher/page.tsx`) actually
  lists the next 8 upcoming sessions, not sessions starting today. Phase 4 builds the real
  "today's classes" view on `/teacher/sessions`; the closed dashboard is left untouched.
- **F5 (Info)** — `PATCH /api/sessions/[id]` returns the full updated session row including
  both links to the caller. Callers are Admin/Supervisor only, so this is within policy;
  recorded for awareness.
- **F6 (Info)** — Rate limiting is in-memory (single-instance); known Phase 1 limitation.

## Baseline state at review time

- Branch `feature/stitch-ui` at `9570618` (the owner's UI commit landed during this review;
  the tree was clean at review time). Phase 4 work branches from here as `feature/phase-4`.
- Baseline to protect: 10 suites / 111 tests (recorded 2026-10-11, Phase 3 closure).

## Addendum (2026-10-13) — what the review missed

This review classified admin/supervisor joins as merely "untested" and concluded "No High
findings". The Phase 4 test matrix later proved the operator join path had been silently
broken since Phase 3: the closed route's `OR: [...(operator ? [{}] : [])]` matches nothing in
Prisma's query compiler, so every Admin/Supervisor join returned 404. A code-level review
could not see it because the pattern *looks* equivalent to the working list route (which uses
top-level conditional spreads instead of an empty OR entry). Recorded as the review's
limitation: untested authorization branches are presumptively broken until a test exercises
them. Fixed and covered in `__tests__/api/phase4-live-links.test.ts`; details in the
phase-04 execution log.
