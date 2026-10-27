# S-00 — In-flight work (return page + review fixes)

> Plan row: `phase-09-plan.md` S-00. Decisions: D19a, D23, D25. Skills: superpowers:test-driven-development, superpowers:verification-before-completion.

## Design
- **Return page** (D19a): `app/[locale]/payments/paymob/return/page.tsx` + `lib/payments/return-status.ts`. Reads only `order` (digits, ≤ 20) → `payment_attempts.provider_order_id`. Viewer must pass the checkout rule (`canActOnStudentFinance`, same academy). States from the DB: invoice PAID / CANCELLED / FAILED, else PENDING → DECLINED when a WEBHOOK `FAILED` audit row exists since the attempt started, otherwise PROCESSING. PROCESSING refreshes every 3 s, 20 times, then shows a "still processing" note. Signed-out or not-allowed viewers and unknown/garbled orders get one generic message.
- The other sub-slices follow the approved plans in `phase-09-plan.md` S-00 (c)–(k).

## Checklist
- [x] (a) commit review slices #1/#4/#5/#6 — f5ee13c
- [x] (b) return page + status display (RET-01..05)
- [x] (c) #3 announcement scheduling
- [x] (d) #8 origin checks
- [x] (e) I-1 join link redirects + login callbackUrl (also wires "sign in and return" on the return page)
- [x] (f) I-2 settlement fallback flags the Admin
- [x] (g) I-3 opt-out drops shared numbers
- [x] (h) M-1 `isUuidParam` on 8 routes
- [x] (i) M-2 teacher host link — D32, 469fe82
- [x] (j) M-3 ngrok host from env
- [x] (k) M-4 provider comment + "console" normalization

## Log
- 2026-10-27: (a) committed after re-running LS/AN/FLG/MR (3 suites, 13 tests green), tsc + lint clean.
- 2026-10-27: (b) RET-01..05 written first and failed (module missing), then green (5/5); tsc + lint clean. Fixture cleanup removes the append-only audit rows (`deleteAppendOnly`).
- 2026-10-27: (e) I-1 — the join route answers browsers (`Accept: text/html`) with redirects on the PUBLIC origin (`platformUrl`, fallback request host): signed out → `/<locale>/login?callbackUrl=/api/sessions/<id>/join[?host=1]` (locale from `NEXT_LOCALE`, default ar); every error → `/<locale>/join-status?reason=<CODE>` (new page, code-only, allowlisted reasons). API callers keep the JSON codes. Login honours `callbackUrl` through `lib/auth/callback-url.ts` (allowlist: the join path, `/ar|en/...` pages; no `//`, `\`, other APIs). The return page's sign-in link comes back to the same order. Tests JL-05..09 written first (4 failed + module missing), then green; the Phase 4 anonymous test now expects `/ar/login` + callback. 5 suites / 75 tests green; tsc + lint clean.
- 2026-10-27: (h) M-1 — UUID-01..08 written first (all 8 routes answered a body-validation 400 before checking the id), then the shared `isUuidParam` → 400 "Invalid identifier." added right after `await params` (session-change-requests moved its id read before body parsing). 6 suites / 96 tests green (incl. VAL-01 edge cases, sessions, assignments, applications); tsc + lint clean.
- 2026-10-27: (j) M-3 — `allowedDevOrigins` = the APP_PUBLIC_URL host (`lib/config/dev-origins.ts`, DEV-01 first, failed on the missing module). **Owner note:** reaching `next dev` through ngrok now needs `APP_PUBLIC_URL` set to the ngrok URL (the one allowed `.env` line). (k) M-4 — provider comment brought up to date; the `console` check is trimmed + lower-cased like the production start check (MSG-09 first, failed, then green). 2 suites / 14 tests green; tsc + lint clean.
- 2026-10-27: (g) I-3 — AN-OPT-01 first (failed: the child on the opted-out guardian's number was still a recipient), then `computeAnnouncementRecipients` skips every number owned by an opted-out user, in both directions. 2 suites / 5 tests green (incl. AN-04..13); tsc + lint clean.
- 2026-10-27: (f) I-2 — INT-EXP-09/10 first (09 failed: no flag when the out-of-period fallback left the balance ≥ 0). `fallbackSubscriptionId` now reports `outsidePeriod`; settlement enqueues `SETTLED_OUTSIDE_PACKAGE_PERIOD` (one per active Admin, dedup per report, payload `{reportId}`), worker text ar/en, no amounts. No schema change (`notification_jobs.kind` is text). credit-expiry 10/10 + reports 28/28 green; tsc + lint clean.
- 2026-10-27: (d) #8 — ORG-01..03 first (01/02 failed with 403 behind a proxy: public Origin/Host, internal request.url). Removed the duplicate origin checks in `api/applications` POST and `api/auth/change-password`; `requireSameOrigin` (Host in dev, ALLOWED_ORIGINS in production, missing Origin refused) is the only guard; a foreign Origin is still 403 (ORG-03). 5 suites / 43 tests green (incl. OWASP, auth-rbac, edge cases, application validation); tsc + lint clean.
- 2026-10-27: (c) #3 — AN-14/15 first (14 failed: the old tick slept through 8 announcements and left the T+5 reminder PENDING; 15 failed: all jobs had the same eligible time). `runWorkerTick(now, academyId?)` now runs the scans first, then due jobs (ordinary kinds before announcements); `ANNOUNCEMENT_SENDS_PER_TICK = 1`, no announcement sleep; the announcement route staggers each job's `scheduledFor` by SPACING + random JITTER. Limits unchanged (8/tick ceiling, 60/hour, 2 per 24 h). AN test's per-tick expectation updated to the new budget. Worker + announcement suites 7 / 37 green; tsc + lint clean.
- **S-00 status at stop (2026-10-27):** all items done except (i) M-2 (OPEN → OQ-16). S-00 is complete apart from the owner's answer.
- 2026-10-27: (i) M-2 — spec check: `zoom_host_url` is optional and the `?host=1` variant exists, but no rule makes the teacher's links use it (CONTEXT §84 open assumption) → OQ-16, nothing built.
- 2026-10-27: (i) M-2 — owner answered OQ-16 → D32 (teacher button opens the host link when stored, else the join link). To build as the next small item.
- 2026-10-27: (i) M-2 built — HL-01 failed first (teacher got the join link), HL-06 static check failed (teacher dashboard linked `?host=1`, a NO_HOST_LINK dead end when no host link is stored). The join route now sends the assigned TEACHER to the host link when stored, else the join link; one Zoom button on both teacher pages ("Start (host)" removed, host note reworded). Phase 4 teacher-join expectation follows D32. 5 suites / 74 tests + 2 suites / 39 tests green; tsc + lint clean. Commit 469fe82. **S-00 complete.**
- 2026-10-27: (i) M-2 REVERSED by the owner (D45): teacher → join link always; `?host=1` for Admin/Supervisor only, everyone else the generic 404; teacher host-link note and its message key removed. HL-01/07/09 failed first; teacher-host-link + phase4-live-links + join-browser + callback-url: 47/47 green; tsc + lint clean. ce236b4.
