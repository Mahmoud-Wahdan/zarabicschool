# Phase 9 — Execution Plan

> Ordered slices for Phase 9 (owner master prompt 2026-10-27). Decisions are referenced by ID from `phase-09-decisions.md` and never restated; open items and SQL are in `phase-09-open-questions.md`. Each slice gets `slices/S-XX-name.md` (design, checklist, running log) when it starts.
>
> **Per slice:** test-first (superpowers:test-driven-development) → `npx tsc --noEmit` + `npm run lint` → ONE local commit (named files, no push/merge/rebase) → update the slice file, PROGRESS and the register → short report (what changed, tests/tsc/lint, items remaining, next slice).
>
> **Global rules:** CONTEXT §21 (real data, ar/en, RTL, mobile, loading/empty/error); server-side authorization + `requireSameOrigin` on every mutation; the Supervisor never receives money fields; ledgers and audits are append-only; no names/phones/links/report text in logs or job payloads; tests use per-run test academies only (never the seed); no OpenWA calls from tests; no migration applied without the owner's OK.

## Order and the one change proposed

The owner's order is kept, with one adjustment: **a slice that needs a migration is designed, its SQL goes to the open-questions file, and the next slice starts while the owner reviews.** No slice waits idle on an answer. The migration-free part of a blocked slice (e.g. S-01's roster-only checks, S-02's D10 guard) ships at once. Reason: S-01, S-02, S-03, S-06, S-12 and S-13 each need SQL, so a strict serial order would stop after step 0.

## Slices

| # | Slice | Decisions | Scope / acceptance | Data / schema | Auth & security | Tests (planned) | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| S-00 | In-flight work | D19a, D25, D23 | (a) commit review slices #1/#4/#5/#6; (b) return page + status display; (c) #3 announcement scheduling; (d) #8 origin checks; (e) I-1 join-link HTML redirects + callbackUrl; (f) I-2 settlement fallback flags the Admin; (g) I-3 opt-out drops shared numbers; (h) M-1 `isUuidParam` on 8 routes; (i) M-2 teacher host link (after the spec check); (j) M-3 ngrok host from env; (k) M-4 provider comment + normalized "console" check | none (I-2 uses the existing Admin notice path; stop if a new flag type needs SQL) | return page: lookup only, checkout authorization, generic otherwise, never settles | RET-01..04, AN-14..15, ORG-01..02, JL-05..07, INT-FB-01, AN-OPT-01, UUID-01..08, PRV-01 | — | done — S-00 complete (last item M-2 469fe82) |
| S-01 | Attendance | D2, D2a | roster-only form + server check (already enforced: report page lists `session.students`, the route 404s off-roster; add regression tests); manual resolution screen/API with every D2 safeguard | **S-1 (ATTENDANCE)** | Admin; Supervisor ≤ 7 days; confirmation step; audit + Admin notice; no payroll write | ATT-01..08 | OQ-1 → D36; S-1 D37, S-1b D46, S-1c D49 (all applied) | done (eab5938); 12/12 |
| S-02 | Teacher approval + minor guardian (**done** 14af707, a6504f9) | D9, D10 | Admin add-teacher with rate; Supervisor add → PENDING + Admin notice; approve sets rate + activates; scheduling/assignment refuse PENDING teachers; add-student refuses a minor without a guardian | **S-2** (teachers) | rate Admin-only; Supervisor never sends a rate | TCH-01..06, STU-G-01..02 | OQ-2, S-2 OK (D10 part none) | done (14af707, a6504f9) |
| S-03 | Time zone (**done** 4b24f54, 5080601) | D3, D3a | device detection on sign-in; profile + Admin edit; every session time rendered in the viewer zone (`Intl`), WhatsApp in the recipient zone | **S-3** (users) | the user edits own; Admin edits any; Supervisor no | TZ-01..06 incl. a DST day | OQ-3, S-3 OK | done (4b24f54, 5080601) |
| S-04 | Join window + reminder | D4, D26, D28 | Admin setting `join_window_minutes` (default 30); all roles; reminder at T−window with the PLATFORM link; login returns to the session (shares I-1 callbackUrl) | none (`academy_settings` key) | link never in WhatsApp; window changes WHEN not WHO | JW-01..05 (+ update Phase 4 tests that assume 15) | S-00(e), OQ-4 | done (f7b544a) — D28 |
| S-05 | WhatsApp icon | D17 | `wa.me/<digits>` icon on student/teacher/guardian views | none | Admin/Supervisor only; `rel="noopener noreferrer"`; numbers never logged | WAI-01..04 | — | done — D17 |
| S-06 | Notification inbox (**done** 4fec4ba) | D12 | inbox aggregating requests, missing reports, unrecorded attendance, flags, complaints (staff), payment anomalies (Admin); unread badge | **S-4** | per-user read state; Supervisor gets no money items | NT-01..05 | S-4 OK | done (4fec4ba); badge fixed in A5 (ce1c2f9, 85f2a04) |
| S-07 | Roster changes | D18, D16 | add/remove on GROUP; cancel PRIVATE; release on removal; block after SUBMITTED/APPROVED report; subscription cancel/reduce lists reservations first | none expected; queries shown first (ATTENDANCE/credit writes); M-6 snapshot SQL if chosen | Admin/Supervisor; academy scope; session lock | RC-01..06 | queries OK'd by the owner, OQ-11 | waits for the owner's OK on queries |
| S-08 | Daily teacher schedule | D5 | midnight-local planner job; one line per session; make-ups listed separately; no send after 08:00; in-app "Today" card covers later changes | none (job kind is text) | payload `{localDate}` only; no links | DS-01..07 | S-03 display, OQ-5 → D31 | done (df54860) |
| S-09 | Supervisor finance visibility | D11 | per-student paid/unpaid + remaining sessions on Supervisor student views | none | a separate Supervisor read model without amounts; `canActOnStudentFinance` unchanged (tests stay); new test proves no money field reaches the Supervisor payload | SFV-01..05 | OQ-6 → D29 | done (f7e5ffe) — D29 |
| S-10 | Weekly calendar | D13, D27 | view-only week grid for student, teacher, guardian (tab per child) | none | own sessions only; no Zoom URL in markup | CAL-01..05 | S-03 display, OQ-7 → D30 | done (624bbae) |
| S-11 | Performance + admin home | D7, D8, D8a | Admin performance table + teacher "my indicators" page; admin home cards (students, teachers, this week) + EGP charts monthly/quarterly/half-year | none | teacher sees own data only; finance Admin-only | PF-01..05, HM-01..04 | — | done (136e63f, 8d8d1eb) |
| S-12 | Deductions & bonuses (**done** ee75a04) | D14 | Admin page: create (category + reason), list, filter, reverse by opposite entry; teacher sees own entries + reason; in-app notice | **S-5 (FINANCIAL)** | Admin only; idempotency key (A5) | DB-01..06 | OQ-8, S-5 OK | done (ee75a04) |
| S-13 | Payment link, then refund (**done** b6ed2db, 32fbd33) | D6, D19, D20 | (a) payment-link WhatsApp; (b) webhook void/refund records + Admin flag; (c) Admin partial refund | **S-6 (FINANCIAL)** | payer-only; Admin-only refund; idempotent; cumulative cap | PL-01..06, RF-01..08 | OQ-12, OQ-13, S-6 OK | done (b6ed2db, 32fbd33) |
| S-14 | Stitch UI migration | D1 | page by page from the Stitch export; tokens first; Impeccable later | none | no money widgets on Supervisor screens | visual review; Playwright smoke after (D22) | — | parallel track |
| G1 | Bug fixes A1–A7 (owner list 2026-10-28) | D67–D70 | tbody whitespace, payment-audit i18n + dynamic-key test, attendance titles, contrast (@layer base + tokens), shared badge provider, auto-renewal flag, Admin today list + D7 note | none | — | see slices/G1-bugfixes.md | — | done (b5d7334, 489526f, 31c26da, 1e9bbcb, ce1c2f9, 024a68f, 08f5802) |
| L | Latency (owner list 2026-10-28) | D71–D73 | measured; icon font → Lucide; shell prefetch off; parallel home queries; streamed badge count; dev-tunnel.md | none | security headers, auth, ledger untouched | see slices/L-latency.md | — | done (77e9779, 73c8766, c00f112, 85f2a04, e6c6182) |
| NEXT | Payer refund request; Netflix-style cancel check; USD via Paymob | D74 | owner 2026-10-29 | tbd | payer-only request, Admin decides | tbd | owner approval to start | waits (next branch) |

Status values: ready / in progress / waits for <X> / done (commit hash).

## Traceability — every item raised in this conversation

| Item | Where | Status |
|---|---|---|
| Review #1 late-start dedup per teacher | S-00(a) | done (f5ee13c) |
| Review #3 announcement scheduling (no sleep in tick, 1 per tick, next-eligible time, tick academy filter) | S-00(c) | done (9087657) |
| Review #4 announcement 5/h counts accepted only | S-00(a) | done (f5ee13c) |
| Review #5 dashboard tile = late reports + separate monthly count | S-00(a) | done (f5ee13c) |
| Review #6 monthly scan batched | S-00(a) | done (f5ee13c) |
| Review #8 legacy origin checks removed, proxy test | S-00(d) | done (f5cf69b) |
| Review #7/#9/#10 → TD-07/09/10 | test-backlog TD-07/09/10 | recorded; TD-07 revisit after Layer 2 |
| I-1 join link: HTML redirects, login + callbackUrl, `platformUrl` | S-00(e) | done (7c9ed20) |
| I-2 settlement "any ACTIVE package" fallback flags the Admin | S-00(f) | done (ecc3336, no SQL) |
| I-3 opt-out drops numbers of opted-out users | S-00(g) | done (bf017fa) |
| M-1 `isUuidParam` on 8 routes | S-00(h) | done (4bf4631) |
| M-2 teacher join `?host=1` | S-00(i) | done (469fe82) — D32; reversed (ce236b4) — D45 |
| M-3 ngrok host from env | S-00(j) | done (2f80028) |
| M-4 provider comment + "console" normalization | S-00(k) | done (2f80028) |
| M-5 payroll cap vs 100,000,000 | OQ-10 → D33 | kept + documented (lib/validation/financial.ts) |
| M-6 complaint roster snapshot | OQ-11 → D41 | answered — SQL when S-07 starts |
| S-1 attendance_resolutions migration | D37 | file created (52cef9b), owner applies |
| Automatic renewal on Paymob subscriptions (MOTO) | S-RENEW, D44, D50-D61 | built and tested with a fake Paymob; real test-mode sign-up waits for the Paymob dashboard |
| SQL S-7 renewal invoices / S-7b INCOMPLETE | D59, D60 | applied (36, 37 migrations) |
| Africa/Cairo time-input bug | owner 2026-10-27 | done (1a36fe0) |
| M-2 reversal (teacher join link; host for Admin/Supervisor) | D45 | done (ce236b4) |
| en/ar message-key parity + phoneCol/whatsappChat | owner 2026-10-27 | done (2dd1da1) |
| "MOTO" renamed to card-not-present auto-renewal | D44 | docs done (9ad00a9) |
| X-Powered-By off | commit be2862c | done |
| Console WhatsApp provider (masked) | commit fdc7e16 | done |
| `APP_PUBLIC_URL` (the one allowed `.env` line) | `.env.example`, deploy-checklist; owner sets the value | owner to-do |
| Secrets rotation | deploy-checklist launch blocker (D21) | deferred to deployment |
| Stitch migration | S-14 (D1) | parallel track |
| Impeccable | after S-14 (D1) | later, not installed |
| Card-not-present auto-renewal (Paymob subscriptions) hold | D19, D44 | on hold until Paymob answers |
| Paymob callback config (localhost return, ngrok processed) | D23 | recorded; owner sets it in the dashboard |
| Layer 2 checklist + test cards | D24 + phase-08 Layer 2 checklist | waits for the owner's "go" |
| Paymob diagnosis invoice 2e4ca7e1 (no webhook ever stored) | phase-08 log; fixed by D23 config + S-00(b) | owner to re-run after config |
| Q16 refuse add to ended session | D16, c9a19af | done |
| E2E accounts after Phase 9 | D22 | later |
| INT-EXP-08 defensive rule | D21 | done (kept) |
| Trial | D15, OQ-9 → D35 | nothing built; doc clean-up done |
| Assignments problems | OQ-14 | OPEN (owner list) |
| Commit trailer formatting | OQ-15 → D34 | dropped (no rewrite) |
| D1–D27 | slices above | see the register |
| Owner to-dos | below | — |

### Owner to-dos (not code)
1. Answer OQ-1..OQ-15; OK (or edit) SQL S-1..S-6.
2. Paymob dashboard: set the two callbacks (D23); keep ngrok + dev running during a payment.
3. Set `APP_PUBLIC_URL` in `.env` (the single allowed line).
4. Say "go" for Layer 2 (D24).
5. Send the Assignments problem list (OQ-14).
6. Later: OpenWA live test (last), secrets rotation at deployment (D21).

## Change log
- 2026-10-27: created from the master prompt (Part 1). Replaces the "Plan (draft)" sections of `phase-09-refinements.md` (kept there as history).
- 2026-10-27: S-04 done (f7b544a); OQ-4/5/6/7/10/16 answered (D28–D33), OQ-15 dropped (D34).
- 2026-10-27: owner answers file — S-1 approved (D37, migration file only), OQ-2/3/8/11/12/13 → D38–D43, auto-renewal naming D44.
- 2026-10-27: Cairo time-input fix (1a36fe0); M-2 reversed (ce236b4, D45); i18n key tests + S-05 key fix (2dd1da1).
- 2026-10-27: S-09 done (f7e5ffe).
- 2026-10-27: time-zone audit (360e7cc, D48); S-01 built (eab5938, waits for the S-1b apply, D46); S-10 done (624bbae).
- 2026-10-27: S-1c applied, S-01 12/12; S-11 done (136e63f, 8d8d1eb); S-08 done (df54860).
- 2026-10-28: automatic renewal built (S-RENEW): d91914f dates + client, 3fe3c9e booking/grace/cancel/webhook, 1352e2c sign-up + SQL S-7b (applied, D60), 23df92f Admin links a plan to Paymob, then the screens (payer consent + cancel, Admin renewals page, plan button).
- 2026-10-28: S-02 done (14af707, a6504f9; SQL S-2 applied), S-03 done (4b24f54, 5080601; SQL S-3 applied); Impeccable installed (D62) and used on the new screens.
- 2026-10-28: S-06 done (4fec4ba; SQL S-4 applied, D64).
- 2026-10-28: S-12 done (ee75a04; SQL S-5 applied), S-13 done (b6ed2db, 32fbd33; SQL S-6 applied), D65.
- 2026-10-28/29: G1 A1–A7 and L1–L4 done (see slice files); D67–D74; full suite stopped by low memory (no result); waiting for the owner's approval before build, migrate status and the new branch.
