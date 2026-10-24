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

*(to be appended as slices land)*
