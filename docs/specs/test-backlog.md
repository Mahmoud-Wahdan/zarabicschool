# Zarabicschool — Test-Debt Backlog (final test phase)

> Purpose: single list of known failing / not-yet-written tests, one line of suspected cause each, accumulated during the "implement first, test after" sessions. This file is created in Session 3 (2026-10-24) and extended after every implementation slice with the tests that slice will need (IDs + what each protects). Tests are NOT written or run until the owner authorizes the test loop (INSTRUCTIONS.md §5).

## Known failing / stale tests (from Sessions 1–2)

1. **`report-attachments` — "hides unapproved reports from students"**
   Suspected cause: stale vs the confirmed visibility rule — reports are visible to the guardian/student the moment they are SUBMITTED in every status (owner 2026-10-18, CONTEXT §9); approval gates pay only.
   Evidence: `webapp/lib/reports/visibility.ts:57-63` (submit-time contract comment) and `webapp/lib/reports/visibility.ts:94-114` (role gates, no status filter).

2. **`report-attachments` — admin remark-list PUT returns 400**
   Suspected cause: stale payload shape, NOT an app bug — the test PUTs the pre-Session-1 legacy `items: ["…", "…"]` string array, while the route validates `items: [{ slug, labels: { ar,en,fr,de,tr } }]` since Session 1.
   Evidence: test payload `webapp/__tests__/api/report-attachments.test.ts:275` and `:327`; schema `webapp/lib/validation/management.ts:230-239`; route validation `webapp/app/api/admin/settings/class-remarks/route.ts:37-40`. Migration `20261015093512` exists and is applied (`npx prisma migrate status` 2026-10-24: 17 migrations, up to date), so the 400 comes from Zod, not from the 409 migration gate. The admin UI sends the correct new shape (`webapp/app/_components/reports-queue/class-remarks-editor.tsx:64-79`).

3. **`scheduling-worker` + `late-report-chain` (3 tests) — jobs FAILED instead of SENT**
   Suspected cause: the fake messaging provider was removed (owner 2026-10-18) but the tests still set `MESSAGING_PROVIDER="fake"` (now ignored by code) and/or delete the `OPENWA_*` variables, so every real OpenWA send returns `{ ok: false }` and the worker correctly records FAILED rows.
   Evidence: provider selection `webapp/lib/messaging/provider.ts:17-18` (always OpenWA); unconfigured send `webapp/lib/messaging/openwa-provider.ts:13-18`; worker FAILED write `webapp/lib/worker/notifications.ts:312-319`; test env setup `webapp/__tests__/worker/scheduling-worker.test.ts:116,182-185` and `webapp/__tests__/worker/late-report-chain.test.ts:95-110`.

3b. **INT-EXP-08 (credit-expiry) — rule CONFIRMED (owner, 2026-10-26, option a); code fixed**
   A late settlement against a still-ACTIVE package whose period ended deducts anyway (balance −1) + `BALANCE_NEGATIVE`; teacher credited. The seam's fallback previously treated this as "no subscription". Counterpart SS-05 (no ACTIVE package at all → no deduction, `SETTLED_WITHOUT_SUBSCRIPTION`, teacher credited) is now written.

4. **INT-MON-02 (monthly-report concurrency, test-plan-session2.md)**
   Suspected cause: race nondeterminism — accept `[201,409]` or `[201,200]` with the same row id and unchanged `submittedAt`; plus add a deterministic P2002→409 test by stubbing `findFirst` → null so the create path hits the unique constraint.
   Source: `docs/specs/test-plan-session2.md` (INT-MON-02).

5. **INT-WH-08 (webhook rollback, test-plan-session2.md) — NOT implemented; needs owner diff approval**
   Suspected cause: requires a test-only seam in `webapp/lib/payments/settlement.ts` that forces a ledger-insert failure inside the settlement transaction (fail-closed in production; the seam must be inert without the test hook).
   Source: `docs/specs/test-plan-session2.md` (INT-WH-08: "Ledger insert forced to fail → transaction rolls back; `webhook_events` row absent; invoice still PENDING").

6. **Playwright — 5 specs**
   Suspected cause: environment/config-gated, not code — `checkout-retry` waits for the owner's confirmation of Paymob test-mode keys; the rest need a dev server + credentials.
   Source: `docs/specs/PROGRESS.md` Phase 8 row; Phase 6b owner steps (Paymob test-mode keys).

## Session 3 additions (appended per slice; IDs + what each protects)

### Slice A — payment audit + manual-payment hide (2026-10-24)

- **PA-01** — invoice CREATE writes one `CREATED` audit row with actor ADMIN in the same transaction (protects: audit completeness at the money entry point).
- **PA-02** — webhook settlement writes one `PAID` row; a forced ledger-insert failure rolls back the claim AND the audit row (extends INT-WH-08 — protects: a PAID audit row can never exist without its financial effects).
- **PA-03** — Admin confirm → `PAID` row with actor; already-paid idempotent path writes NO second row (protects: no audit spam/duplication on retries).
- **PA-04** — proof REJECT → one `REJECTED` row; proof CONFIRM writes no audit row (by design: the PAID event belongs to the confirm/settlement) (protects: event semantics).
- **PA-05** — checkout stale-attempt takeover → one `FAILED` row with the caller as actor; provider-refused checkout → `FAILED` row, best-effort, the payer still gets the error (protects: failure observability without changing outcomes).
- **PA-06** — append-only trigger: `UPDATE`/`DELETE` on `payment_audit` raises (protects: the audit cannot be rewritten from the app or psql session).
- **PA-07** — `/admin/payment-audit` reachable as ADMIN; Supervisor/Teacher/Student/Guardian get the role redirect/403 (protects: money-audit read boundary).
- **PA-08** — metadata allowlist: a payload with unknown/gateway keys stores only allowlisted keys; no `source_data`/`pan` ever reaches `payment_audit.metadata` (protects: no card data, no gateway payloads).
- **PA-09** — hidden UI: admin invoices panel renders no Confirm/proof-review forms and the payer panel renders no proof-upload form, while the dormant APIs still enforce their unchanged authorization (protects: the hide-only contract).

### Slice B additions — session evaluations (2026-10-24)

- **EV-01** — STUDENT on the roster submits → 201, one row; second submit → update within 24h (protects: one per (session, author)).
- **EV-02** — GUARDIAN of a roster child submits → 201; guardian with TWO children on the same group-session roster still has exactly ONE evaluation (unique key) (protects: the owner-confirmed multi-child rule).
- **EV-03** — student/guardian NOT linked to the session → generic 404 (no existence oracle) (protects: minors' data visibility boundary).
- **EV-04** — rating 0 / 6 / non-integer → 400; comment > 2000 → 400 (protects: schema CHECK mirrors validation).
- **EV-05** — edit after 24h → 403 EVALUATION_LOCKED; edit within → 200, same row id (protects: server-side lock).
- **EV-06** — concurrent first-submits → exactly one row, no 500 (P2002 recovery path) (protects: double-click/race).
- **EV-07** — session CANCELLED/MISSED or not yet ended → 409 (protects: post-session-only rule).
- **EV-08** — TEACHER GET/POST on the route → 403; no teacher page/payload selects `session_evaluations` (grep guard in review) (protects: TEACHER NEVER SEES).
- **EV-09** — Admin session-detail shows both evaluations; Supervisor sees them; neither mutates (protects: read-only relaying view).

### Slice C additions — notification bell + item B finding (2026-10-24)

- **NB-01** — `GET /api/notifications/badge` is viewer-scoped: an ADMIN sees only their academy's queue depths; a GUARDIAN sees only their own unacked jobs (protects: no cross-recipient leakage).
- **NB-02** — badge counts appear in the shell on EVERY role page (not only dashboards) (protects: the shared-layout requirement).
- **NB-03** — a TEACHER's count NEVER includes evaluation-related jobs: no such jobs exist (slice B enqueues nothing) AND the SQL excludes `kind LIKE 'EVALUATION%'` (protects: the owner's teacher-exclusion invariant, structurally).
- **NB-04** — `POST /api/notifications/badge` (family roles) sets `read_at` ONLY on the viewer's own jobs; ADMIN/SUPERVISOR POST → 403 (team queues have no per-user read state) (protects: ack scope).
- **NB-05** — pre-migration (no `read_at` column): the family-role count answers 0 and the ack is a no-op — no crash (protects: self-healing).
- **RB-01 (item B)** — the "after scheduled end" report gate (`app/api/sessions/[id]/students/[studentId]/report/route.ts:78`) compares true UTC instants; creation input requires an explicit offset (`z.string().datetime({ offset: true })`, `lib/validation/management.ts:111`) and the form converts wall clock via the DST-safe `wallClockInputToUtc` in the SESSION timezone (`lib/schedules/recurrence.ts:36-39`, `use-smart-session-form.ts:130`) — timezone handling cannot make the GATE wrong. The teacher-facing "not finished until T" message WAS wrong: it rendered T in the server's local zone (`teacher/sessions/[id]/report/page.tsx:71`, no `timeZone` option) — fixed to the viewer's timezone; the rule itself is unchanged.

### fix/session-reports-ui additions (2026-10-25)

- **SR-01** — roster button state per (session, student): before end → disabled + end time in the VIEWER tz; no report → write; SUBMITTED → awaiting review; APPROVED/ARCHIVED → approved; REJECTED → edit + reason; CANCELLED/MISSED → nothing (protects: UI mirrors the server gate).
- **SR-02** — a teacher's roster statuses never include another teacher's reports (`getTeacherRosterReportStatuses` scoped by teacher user id) (protects: teacher isolation).
- **SR-03** — first submit with picked files: report 201 then attachments 201; attachment failure leaves the report SUBMITTED and shows the retry uploader (protects: submit never rolled back by storage).
- **SR-04** — coded API errors render localized messages (SESSION_NOT_FINISHED, SESSION_NOT_REPORTABLE, ALREADY_SUBMITTED, REPORT_IMMUTABLE) (protects: owner finding 1).
- **ST-01** — `/student/reports`: student WITH guardian sees only homework/notes/attachments; adult without guardian also remark+summary; other students' reports never listed (protects: visibility rules).
- **ST-02** — "Evaluate" shows only on ended, non-cancelled sessions the student is on; the API still rejects before end/off-roster (protects: eligibility).
- **ST-03** — grep guard: no `app/[locale]/teacher/**` or `app/_components/reports/**` file imports `lib/evaluations` (protects: teacher never sees evaluations).
- **CR-01** — `classRemarkLabel` resolves `needs_follow_up`, `needs follow-up` and the 5 seeded slugs in ar/en/fr/de/tr even with an empty options list; unknown slug → slug (protects: owner finding 4).
- **CL-01** — Cloudinary signature = sha1(sorted params + secret), `api_key`/`file`/`resource_type` excluded (documented example vector) (protects: upload/download auth).
- **CL-02** — any CLOUDINARY_* missing → upload 409 STORAGE_NOT_CONFIGURED, no crash; pre-migration → 409 STORAGE_MIGRATION_PENDING (protects: coded failure).
- **CL-03** — uploaded row stores public_id/resource_type/format/bytes with `storage_provider='cloudinary'`; no URL in DB or API responses (protects: no public URLs).
- **CL-04** — download URL issued only after `getReportForViewer` passes: unrelated student/guardian/teacher → 404; URL has `expires_at` ≤ now+300 s and `type=authenticated` (protects: private files).
- **CL-05** — signature allowlist: MP3/M4A/OGG/WAV accepted for report attachments, rejected for payment proofs; MP4 video rejected; >10 MB → 413 (protects: type/size policy).
- **CL-06** — DB insert failure after upload removes the Cloudinary object (attachments + proofs) (protects: no orphans).
- **CL-07** — legacy `storage_provider='supabase'` rows still sign through the Supabase provider (protects: existing files readable).
- **CL-08 (test maintenance)** — `report-attachments` + `invoices-checkout` tests must adapt to the new `StorageProvider` shape (`upload({folder,…})` returns the object; fake keys carry no extension).

### Session 4 additions (2026-10-25) — report-form fix + session completion

- **RF-01** — report POST for a session whose id is a legacy non-RFC uuid (`00000000-0000-0000-0000-…`) passes the path check and reaches the business rules; a non-uuid string still → 400 (protects: Item 1 root cause).
- **RF-02** — every route using `z.guid()` still rejects non 8-4-4-4-12 input (protects: no malformed id reaches Postgres).
- **RF-03** — form: a stored remark slug absent from the academy list renders the disabled placeholder and blocks submit client-side; server `VALIDATION_ERROR` with `fields.classRemark` shows the remark message, not "complete the fields" (protects: no displayed-but-unselected value).
- **RF-04** — rejected submit uploads nothing (no Cloudinary object); post-acceptance upload failure leaves the report SUBMITTED and re-reads the list; retry creates no duplicate row (protects: no orphans/duplicates).
- **SC-01** — concurrent last-two reports of a 2-student group session: both 201/200, session COMPLETED exactly once, no error (protects: row lock vs write skew).
- **SC-02** — reject a report after completion: the session stays COMPLETED; the resubmission keeps it COMPLETED (protects: rejection never reverts).
- **SC-03** — group session (3 students): COMPLETED only after the 3rd report; after 1–2 reports it stays SCHEDULED and the UI shows "1 من 3"/"2 من 3" (protects: per-student independence).
- **SC-04** — single-student session: the first submitted report completes it in the same transaction; a forced failure after the report insert rolls back both (protects: atomicity).
- **SC-05** — completion creates NO `subscription_ledger`/`payroll_ledger` rows (count before/after) (protects: settlement only on approval).
- **SC-06** — CANCELLED/MISSED sessions are never completed; resubmit/replay on a COMPLETED session writes no second transition (protects: idempotency).
- **SC-07** — concurrent resubmits of the same REJECTED report: exactly one 200, the other 409 ALREADY_SUBMITTED (protects: editable only after rejection under concurrency).
- **SC-08** — `GET /api/sessions` returns `reportCount` to ADMIN/SUPERVISOR/TEACHER only; STUDENT/GUARDIAN payloads have no `reportCount` (protects: classmates' report state).

## Session 5 Part 1 — WhatsApp (d)+(e) (2026-10-25)
- **WA-01** — phone normaliser: `01012345678`/`1012345678`/`201012345678` → `201012345678`; `+14155550102`/`0044…` unchanged; `12345`/letters → null (protects: abroad users, no guessed country code).
- **WA-02** — adapter calls `POST <base>/api/sessions/<id>/messages/send-text` with `{chatId:"…@c.us", text}` + `X-API-Key` + `Idempotency-Key`; the 201 `messageId` is returned (HTTP mocked at the boundary).
- **WA-03** — non-production: number not in `OPENWA_SEND_ALLOWLIST` → `{ok:false}`, no HTTP call; empty allowlist → nothing sent; production ignores the allowlist.
- **WA-04** — transient (409/429/5xx/network) → PENDING again after 2 min then 10 min, FAILED after the 3rd send; permanent (400/401/404/no config) → FAILED after one send.
- **WA-05** — PROCESSING older than 10 min → FAILED and not re-sent; younger rows untouched.
- **WA-06** — SESSION_REMINDER/SESSION_START due after `scheduledEnd` → CANCELLED, provider not called.
- **WA-07** — webhook: no secret env / no header / wrong signature / signature over a re-serialised body → 401 and no DB write; valid → 200.
- **WA-08** — webhook forward-only: READ then replayed DELIVERED stays READ; FAILED after DELIVERED stays DELIVERED; unknown messageId → 200 nothing changed; other sessionId → ignored.
- **WA-09** — `POST /api/admin/messages`: Supervisor/Teacher 403; cross-origin 403; other-academy recipient 404; no phone 409; 21st message in 10 min 429; job payload is exactly `{adminMessageId}`; response contains no body text.
- **WA-10** — `GET /api/admin/whatsapp/health`: Supervisor 403; response never contains the API key; OpenWA down → `reachable:false`.
- **WA-11** — whatsapp-number PUT: Admin only, invalid format 400; landing/footer render `https://wa.me/201060814239` from the setting; no link when the row is missing.
- **WA-12** — pre-migration: messages route 409 `WHATSAPP_MIGRATION_PENDING`; webhook acks without writing; worker sends without storing the message id.

## Session 5 Stage 2 plan — tests to write when each item is implemented (phase-06 § "Session 5")
- **SEED-01/02** — after the demo seed: no APPROVED/ARCHIVED report without settlement; only `billing.pay_per_session.*` keys.
- **PM-01..PM-10** — Paymob: each success-predicate flag (pending, is_voided, is_refunded, is_void, is_refund, error_occured, auth-without-capture) blocks settlement; match by `order.id` only (forged `merchant_order_id` ignored); amount/currency mismatch → `mismatch`, no money; pending then success for the same txn settles once; success on a PAID invoice → anomaly flag, no money; replay → `already_processed`; concurrent duplicates → one settlement.
- **RA-01..RA-03** — approval of a report of a CANCELLED session → 409 `SESSION_CANCELLED`, zero ledger rows; cancel between submit and approve; reject still allowed.
- **OT-01..OT-03** — overtime: missing rate → stays PENDING, no ledger; double click → one row; failure after the ledger insert → both rolled back.
- **AN-01..AN-03** — ANNUAL: invoice create 409, checkout 409, signed success ignored + flag.
- **PR-01..PR-04** — payroll idempotency key duplicate → one row; currency mismatch 409; cross-origin 403; Supervisor 403.
- **SS-01..SS-03** — seam: concurrent attended reports of one group session → no 500, one credit; no subscription → teacher paid + Admin flag; consumption order earliest-expiring first.
- **SEC-01/02** — seed aborts without `SEED_DEMO_PASSWORD`; demo seed leaves the Admin hash unchanged.
- **AP-01/02** — profiles `type=constructor|__proto__|toString` → 400; Supervisor never receives Admin/Supervisor rows.
- **SO-01/02** — every mutating route: cross-origin/missing Origin 403, same-origin OK; webhooks unaffected.
- **PW-01..PW-03** — admin-set password forces change for ADMIN/SUPERVISOR/TEACHER; student unchanged; self-change clears.
- **FW-01..FW-03** — one finance-wall helper on checkout/invoices/proofs/page; pay-per-session count outside min/max → 400.
- **PF-01** — `/teacher/sessions` shows today's sessions when the teacher has >100 older ones.
- **PL-01..PL-05** — payment-link message (when built): Supervisor 403; never to a student with a guardian; PAID invoice 409; second send same day blocked; text contains no provider URL/token.

## Session 5 — schema hardening (2026-10-25)
- **HD-01** — each new CHECK (invoices, subscriptions, subscription_ledger, payroll_ledger, teacher_rates, sessions) rejects its invalid row.
- **HD-02** — a second INITIAL_PURCHASE for the same invoice is rejected (duplicate webhook).
- **HD-03** — duplicate teacher rate (same teacher, same effective_from) → 409 RATE_ALREADY_EXISTS.
- **HD-04** — an http:// Zoom link is rejected by the DB even if the code check is bypassed.

## Session 5 — demo seed (2026-10-25)
- **SD-01** — the copied settlement in `prisma/seed-demo.ts` produces exactly the rows the real `settleApprovedReport` / `settlePaidInvoice` produce for the same input (compare row shapes; protects: seed drift from production logic).
- **SD-02** — approving the seeded SUBMITTED report through the API writes one deduction + no second credit for an already-credited session (real path).
- **SD-03** — the seed refuses a non-empty DB and `NODE_ENV=production`; missing `SEED_DEMO_PASSWORD` aborts before any write.

## Session 5 — monthly reports wrap-up (2026-10-26)
- **MR-01** — worker on day 4–7 (teacher's local calendar) with missing reports for the previous month creates exactly ONE `MONTHLY_REPORT_MISSING` flag per (teacher, month); a second tick and a second day create none (partial unique + pre-check).
- **MR-02** — no flag on days 1–3 or 8+; no flag when every eligible student has a report; days 1 and 3 still enqueue the WhatsApp reminder, days 4–7 do not.
- **MR-03** — DB rejects a flag with both `session_id` and `month_key`, with neither, or with a malformed `month_key` (`teacher_flags_anchor_check`).
- **MR-04** — teacher dashboard card shows the missing count for the previous month only and disappears after the last report is submitted; never shows other teachers' counts.
- **MR-05** — `/admin/monthly-reports` shows the "Flagged" chip only for teachers flagged for the selected month; Supervisor sees the same; Teacher/Student/Guardian get 403/redirect.
- **MR-06** — student `/student/sessions` report link appears only after a report exists for THIS student (group session: another student's report does not show the link); upcoming dashboard list excludes CANCELLED.

## Session 5 — Phase 6 slices (2026-10-26, in addition to PM/RA/OT/AN/PR/SS/AP/SO/PW/FW above)
- **PM-11** — UNMATCHED success stored as `<txn>:UNMATCHED`; after the order is linked, the same transaction settles (not `already_processed`).
- **PM-12** — success on an already-PAID invoice (different txn) → `already_settled`, webhook event `DUPLICATE_PAYMENT`, one FAILED audit row, one PAYMENT_ANOMALY job per Admin, no ledger row.
- **PM-13** — signed body with a missing/odd field → 200 `invalid_shape`, one INVALID_SHAPE event per raw body, log has field names only.
- **PM-14** — envelope `{type,obj}` + `?hmac=` query AND flat body + `hmac` header both verify; unsigned → 401, nothing stored.
- **PM-15** — `is_void:true` added to a signed success (not HMAC-covered) → FAILED outcome, no VOIDED anomaly.
- **PM-16** — body > 64 KB (content-length and actual bytes) → 413.
- **CX-01** — cancel a session with an APPROVED report → 409 `SESSION_HAS_SETTLED_REPORTS`; outage approval (SESSION scope) on it → same 409; without approved reports both still work.
- **CX-02** — concurrent approve vs cancel on one session: exactly one wins; never a CANCELLED session with ledger rows.
- **SS-04** — no reservation + two subscriptions where the earliest-expiring one's credit is fully held by RESERVED bookings → deduction goes to the other one.
- **SS-05** — no subscription at all → teacher credited, no deduction, SETTLED_WITHOUT_SUBSCRIPTION job per Admin.
- **SS-06** — BALANCE_NEGATIVE reaches every active Admin (one job each).
- **PR-05** — same Idempotency-Key + different amount → 409 `IDEMPOTENCY_KEY_REUSED`; same key + same entry → 200 with the first row; invalid key → 400.
- **PR-06** — adjustment in a currency other than the teacher's rate currency → 409 `CURRENCY_MISMATCH`; teacher without a rate → 409 `NO_TEACHER_RATE`.
- **AP-03** — `?type=constructor|__proto__|toString` on GET and POST `/api/admin/profiles` → 400; never a list of Admin/Supervisor rows.
- **SO-03** — every POST/PATCH/PUT/DELETE under `app/api` (except the two webhooks) answers 403 `ORIGIN_NOT_ALLOWED` without a same-origin `Origin` (static sweep + one request per route); `auth/change-password` included.
- **PW-04** — Admin creates an ADMIN/SUPERVISOR → `must_change_password` true + `password_set_by_id/at`; Admin edits own password → false; edit without password → flag unchanged.
- **FW-04** — minor student WITHOUT a guardian: checkout/invoice detail/proofs → 403/404 (strict rule).
- **PF-02** — `/teacher/sessions` lists sessions from 7 days back to 30 days ahead only.

## Session 5 — Phase 7 + late start (2026-10-26)
- **AN-04** — POST /api/announcements: TEACHER/STUDENT/GUARDIAN → 403; SUPERVISOR and ADMIN → 201; stale `confirmRecipientCount` → 409 RECIPIENTS_CHANGED + new count, nothing written.
- **AN-05** — recipients: two users sharing one number → one job; user without a number → no job but sees the widget; inactive users excluded.
- **AN-06** — announcements row cannot be UPDATEd/DELETEd (append-only trigger); no PATCH route exists.
- **AN-07** — worker throttle: >8 due announcement jobs in one tick → 8 sent, the rest stay PENDING (not claimed); 60 sent in the last hour → none sent; non-announcement jobs in the same batch still go out.
- **AN-08** — default expiry = sent + 3 days; expiresAt in the past or > 90 days → 400; expired announcement absent from the widget but present in /announcements.
- **AN-09** — logs contain no announcement text and no phone numbers (grep the worker/route output).
- **CP-01** — complaint by a student about the teacher of their session → 201; NAMING a classmate or any guardian → 400; about a session they are not on → 404.
- **CP-02** — teacher files about a roster student and that student's guardian → 201; about a student of another session → 400.
- **CP-03** — the concerned party (and the filer) cannot read the complaint: no API route returns it, /admin/complaints and /admin/complaints/:id redirect for non-operators; no notification_jobs row is created by filing or resolving.
- **CP-04** — workflow: RESOLVE on NEW → 409; START twice → second 409; RESOLVE without a note → 400; concurrent START → one wins.
- **CP-05** — cross-academy complaint id → 404.
- **CT-01** — click timeline data layer returns nothing for TEACHER/STUDENT/GUARDIAN; operator view lists the assigned teacher as "Assigned teacher" with minutes from start; no URL in the payload.
- **EV-01** — /admin/evaluations: TEACHER redirected; averages/counts per teacher match the rows; comments show author type only.
- **EV-02** — evaluation prompt card: COMPLETED session ended within 7 days without own evaluation → card; after evaluating → gone; CANCELLED/MISSED/SCHEDULED sessions never counted.
- **LS-01** — SCHEDULED session, no teacher click: T+4 → no job; T+5 → one TEACHER_LATE_START to the teacher only; T+10 → one TEACHER_LATE_START_ADMIN per active Admin; repeated ticks → no duplicates.
- **LS-02** — teacher clicks between enqueue and send → job CANCELLED; session cancelled or ended → CANCELLED.
- **LS-03** — a STUDENT click does not count; students/guardians never receive late-start jobs; message text contains no URL.
- **LS-04** — COMPLETED/CANCELLED/MISSED sessions and sessions older than 60 minutes are never scanned.

## Session 5 — owner follow-ups (2026-10-26)
- **JL-01** — `composeJobMessage`: SESSION_START / SESSION_REMINDER / TEACHER_LATE_START never contain `zoom.us`; inside the join window they contain `<NEXTAUTH_URL>/api/sessions/<id>/join`; T−2h reminder contains no URL and says the link opens 15 minutes before; NEXTAUTH_URL unset → no URL.
- **JL-02** — GET `/api/sessions/:id/join` signed out → 307 to `/login` (no JSON 401); signed in → click row + redirect (unchanged).
- **CP-06** — student in a group session: parties = teacher only, `otherParticipant` true; 1:1 session (only own family) → false; POST `OTHER_PARTICIPANT` when not offered → 400; when offered → 201 with both concerned columns NULL; teacher posting `OTHER_PARTICIPANT` → 400.
- **CP-07** — the parties API never returns a name or id of another family; the admin detail of an unnamed complaint shows the roster.
- **CP-08** — DB CHECK: concerned_user_id NULL with concerned_role set (or the reverse) → rejected.
- **AN-10** — recipients exclude ADMIN/SUPERVISOR and `announcements_opt_out = true` users; composer `optedOut` count matches.
- **AN-11** — third announcement within 24 h → 429 ANNOUNCEMENT_DAILY_LIMIT, no row, no jobs; two concurrent sends when one slot is left → exactly one succeeds.
- **AN-12** — PATCH `/api/admin/profiles/:id` `{announcementsOptOut}` as SUPERVISOR → 403; as ADMIN → 200; ADMIN/SUPERVISOR target → 404.
- **SH-01** — every response (page, API, static) carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.

## Phase 9 (planned — draft 2026-10-26; written with each slice, IDs reserved)
- **P9-JW-01..03** — join window 30 min: T−31 → JOIN_NOT_YET_OPEN, T−30 → redirect + click row; Admin/Supervisor exempt; button hint shows the constant.
- **P9-TZ-01..08** — country → default IANA zone; multi-zone country requires/permits a choice; only allowed editors can change it; lists, dashboards, invoices and WhatsApp texts render in the viewer's/recipient's zone; DST transition day.
- **P9-DS-01..06** — daily schedule: two ticks → one job; DST day; only cancelled sessions → no job; make-ups listed separately; no Zoom URL in text; missing OpenWA config → FAILED.
- **P9-HM-01..03** — Admin home counts match the DB; finance charts absent from the Supervisor payload; per-currency sums match the ledgers.
- **P9-TC-01..04** — teachers table: rate absent for Supervisor; add-teacher writes one effective-dated rate; deactivate never deletes; cross-academy 404.
- **P9-ST-01..03 / P9-GD-01..02** — students/guardians pages: Supervisor sees no money; minor-without-guardian rule per the owner's answer; family view scoped to the academy.
- **P9-NT-01..03** — inbox aggregates the queues correctly; read-state per the owner's rule; no money items for Supervisor.
- **P9-CA-01..03** — calendar: own sessions only for students/guardians; no Zoom URL in markup; timezone rendering.
- **P9-PF-01..04** — performance: Admin/Supervisor only; punctuality uses the owner's threshold on platform clicks only; evaluation authors by type only; teacher access per the owner's answer.
- **P9-RC-01..05** — roster changes (9.13): add a student to a GROUP session reserves credit (insufficient → blocked/override); remove releases the reservation; removal blocked once the student has a SUBMITTED/APPROVED report; PRIVATE session has no per-student removal (cancel instead); cancelling/reducing a subscription with upcoming reservations lists the sessions and refuses until they are removed.
- **P9-DB-01..05** — deductions/bonuses: Admin only (Supervisor 403); append-only; idempotency key; currency = teacher's; reversal only by an opposite entry.

## Phase 8 — written 2026-10-26 (manual payment)
- **MP-01..07** (`__tests__/api/manual-payment.test.ts`, covers PA-03/PA-04): Admin confirm settles once (PAID, subscription, one INITIAL_PURCHASE, attempt SUCCEEDED, one PAID audit by the Admin); replay → already_settled; concurrent double click → once; Supervisor/teacher/student/guardian 403, foreign Admin 404; CANCELLED → 409; REJECTED proof → 409 PROOF_REJECTED; PENDING proof → CONFIRMED by the Admin, no extra audit row; pay-per-session → no period.

## Tech debt from the code review of 2026-10-27 (owner: do NOT change now)
- **TD-07 (money code, efficiency only):** `lib/reports/settlement-seam.ts` `fallbackSubscriptionId` loads every ledger row of each candidate package to sum it in code inside the approval transaction (which holds the session share lock). Correct today; slower with long-lived pay-per-session packages. Use a DB aggregate (`_sum`) + reservation `_count`. **Revisit after Layer 2, together with the transaction-timeout question** (phase-08 "Decision: transaction timeouts").
- **TD-09 (cleanup):** the "notify every active Admin" writer exists twice — `enqueueAdminFlag` (settlement-seam) and `enqueuePaymentAnomaly` (lib/payments/settlement). Move to one shared helper so the two cannot drift.
- **TD-10 (cleanup):** report approval takes the session `FOR SHARE` lock twice (review route + `settleApprovedReport`). Keep the lock in one place and document the precondition so the lock order is defined once.

## Written 2026-10-27 (code-review slices)
- **LS-05** — replaced teacher after T+5 → reminded once; old teacher's pending reminder CANCELLED.
- **AN-13** — refused announcement attempts never use the per-author hourly cap.
- **FLG-01** — dashboard counts: LATE_REPORT vs MONTHLY_REPORT_MISSING separately, per academy.
- **MR-02** — one monthly-scan tick on a flag day: eligibility/reports queried once, no per-teacher flag lookups.

## Written 2026-10-27 (S-04 join window)
- **JW-01** — no setting → window 30 min (T−29 joins, T−31 JOIN_NOT_YET_OPEN).
- **JW-02** — the join route follows the Admin setting (60 / 10).
- **JW-03** — Admin-only GET/PUT; Supervisor/teacher 403; 4 / 121 / 30.5 / "30" / null → 400; foreign Origin 403.
- **JW-04** — reminder queued at start − window (no T−2h); start message unchanged.
- **JW-05** — saving re-times PENDING reminders of future sessions only (SENT and started untouched).
- **JW-06** — inside the configured window the reminder carries the platform link, never zoom.us; before it, the text names the configured minutes.

## Written 2026-10-27 (M-2 teacher host link, D32)
- **HL-01..05** — assigned teacher's plain join → host link when stored, else join link; students/guardians/Admin/Supervisor keep the join link; click still logged.
- **HL-06** (static) — teacher pages never link `?host=1`.

## Written 2026-10-27 (S-05 WhatsApp icon, D17)
- **WAI-01..03** — wa.me link with international digits (Egyptian local, international kept), new tab + `noopener noreferrer` + aria-label; unaddressable/missing → no link.
- **WAI-04/05** (static) — no logging / no messaging provider in the component; the staff list renders it and the API stays Admin/Supervisor only.

## Written 2026-10-27 (owner answers file)
- **ATT-S1-01/02** (static) — S-1 migration BOM-free with the extra CHECK and the append-only trigger; cleanup handles `attendance_resolutions` before `subscription_ledger`, gated until the owner applies it.
- **ATT-CC-01/02** — report submission and approval wait on the session row lock (`FOR UPDATE`) the resolution write path takes. The end-to-end resolution-vs-report race is written with S-01 once the migration is applied.
- **TZ-01..05** — Africa/Cairo typed times and "today" on 2026-10-27 (UTC+3) and 2026-10-30 (UTC+2), the 25-hour change day, and a static check that no caller uses the host or browser zone.
- **HL-07/08/09** — D45: teacher `?host=1` → 404; Admin/Supervisor `?host=1` → host link; teacher pages show no host note. HL-01 now expects the join link.
- **I18N-01..03** — en/ar key parity; scanner self-check; every literal `t("key")` exists in both catalogs.
