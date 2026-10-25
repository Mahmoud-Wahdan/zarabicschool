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
