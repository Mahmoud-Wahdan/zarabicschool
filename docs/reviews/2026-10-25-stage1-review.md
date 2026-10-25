# Stage 1 review — 2026-10-25 (branch `review/claude-code-payments`)

> Read-only review. No application code, schema, migration or data was changed. DB checks ran inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`. Critical/High code findings below were re-verified by reading the cited lines, not taken from sub-reviews on trust. Paymob callback-format items are marked **needs sandbox** — they cannot be confirmed without Paymob's test mode.

## Stage 0 results

| Step | Result |
|---|---|
| a. Branches | Linear history; every local/remote branch already contained in `fix/session-reports-ui`. |
| b. Merge to main | `8ec72ed` (local `--no-ff`), since superseded on GitHub by PR #2 (`b9c78ae`) + `68835bb`; local `main` = `origin/main`, nothing unpushed. |
| Post-disk-full checks | `git status` clean · `git fsck --no-dangling` exit 0, no output · `git diff --stat HEAD` empty. |
| Verification on main | `.next` deleted → `prisma generate` OK → `tsc --noEmit` exit 0 → `eslint` exit 0 → `npm run build` exit 0 (50 s). |
| c. Review branch | `review/claude-code-payments` created from `main`. |
| d. `prisma migrate status` | 21 migrations, "Database schema is up to date". `_prisma_migrations` also holds one rolled-back attempt of `20261018190000` (2026-10-21) re-applied 5 s later — benign. |

## Performance (Stage 1C) — measured

Environment facts: project is on **G: = WD2500AAKX spinning HDD**; C: = SATA SSD. Supabase eu-west-2 round trip **64 ms**, new connection **~280 ms**.

| Measurement (C: has free space again) | Result |
|---|---|
| Cold start, no `.next/dev` cache → "Ready" | 2.2 s |
| First compile of `/ar/login` | 10.7 s (9.8 s Next/Turbopack) |
| Warm restart → "Ready" | 0.8 s |
| First view of each role page (warm cache) | 1.9–4.2 s (compile ≈ 1.3–2.1 s) |
| Repeat view of the same page | 0.42–0.64 s, of which ~0.4–0.6 s is application code |
| Landing `/ar` repeat view | ~1.0 s (≈0.8 s application code, unauthenticated) |

**Was the full disk part of the slowness?** Likely yes, but it cannot be proven after the fact: with C: at 0 MB the build failed with ENOSPC; npm/npx cache, Node temp and the 8.85 GB pagefile all live on C:, so a full C: stalls `npx`, compilation workers and memory paging. Today the "~1 minute" does not reproduce — the slowest single step is the 10.7 s first compile. A second strong candidate was observed during this session: **DNS resolution failed for several minutes** (Supabase host and github.com both timed out). With `pg`'s default 10 s idle timeout, connections are re-opened often, and each reopen needs DNS + TLS — a flaky resolver turns that into multi-second stalls.

**C: is filling again:** npm cache regrew 1.61 GB in 3 h (from `npx prisma` / `next` runs). C: free went 5.12 → 2.42 GB. Not cleaned (owner approval needed).

Ranked causes of the steady 0.5 s per page (code side):
1. No `relationJoins` preview feature — every nested `include` is an extra sequential round trip (`prisma/schema.prisma:1-4`); ≈8 RT × 64 ms ≈ 0.5 s, matching the measurements.
2. `pg` Pool with defaults (`lib/prisma.ts:13`): 10 s idle timeout → frequent 280 ms reconnects.
3. Sequential awaits / duplicate lookups (teacher report page probe → session; student invoices double `student.findUnique`; class-remarks probe → read).
4. Readiness probes cache only positive results in module scope (lost on HMR).
5. Badge fetch on every page mount duplicates the admin counts; `notification_jobs(recipient_user_id)` has no index.
6. Browser side: Material Symbols loaded twice (4 MB local woff2 + remote Google CSS, both `display=block`); full message catalog (ar 113 KB) sent on every page; 4 font families.
7. Startup: `instrumentation.ts` awaits the whole worker graph (Prisma TS client 5.6 MB) before the first request; redundant `dotenv` in `next.config.ts` (the "injected env (0)" line — harmless).
8. Correctness bug found on the way: `/teacher/sessions` lists the **oldest** 100 sessions (`orderBy asc, take 100`, no date bound) — today's sessions disappear once a teacher passes 100.

## Payments & payroll — CRITICAL / HIGH (verified in code)

| # | Sev | Where | Problem |
|---|---|---|---|
| P1 | **Critical** | `lib/payments/paymob.ts:169` | Payment = `success === true` only. `pending`, `is_voided`, `is_refunded`, `is_refund/void`, `is_auth && !is_capture`, `error_occured`, `has_parent_transaction` are ignored. A void/refund callback for a still-PENDING invoice would mark it PAID and grant credits; a refund on a PAID invoice is stored as a success, so no REFUND entry is written. |
| P2 | High | `lib/payments/settlement.ts:70-81,115` | A non-success (e.g. `pending`) event is stored in `webhook_events` under the same unique key settlement claims → the later real success with the same transaction id answers `already_processed`; payer charged, invoice stays PENDING (**needs sandbox** for Paymob's exact sequence). |
| P3 | High | `paymob.ts:13-34,168`; `settlement.ts:158` | Invoice lookup uses `merchant_order_id`, which is **not** in the HMAC; the signed `order.id` is never compared with `payment_attempts.provider_reference`. A replayed signed body with a different `merchant_order_id` can settle another PENDING invoice of the same amount. |
| P4 | High (**needs sandbox**) | `webhook/route.ts:11`; `paymob.ts:161-168` | HMAC read from an `hmac` header and fields from the body top level; Paymob's processed callback is documented as `{type, obj:{…}}` with `?hmac=` in the query. If so, every real callback is 401 → no online payment ever settles (fails closed). Tests use the same flat shape, so they cannot catch it. |
| P5 | High | `lib/reports/settlement-seam.ts:40-46` | Approval never checks session status. Group session: report A submitted, then session cancelled / marked MISSED (reservations released) → approving A still credits the teacher and deducts the student. |
| P6 | High | `app/api/reports/[id]/overtime/route.ts:52-86` | Overtime `APPROVED` is committed before the ledger transaction; if the ledger write fails (`NO_TEACHER_RATE`, DB error) the claim stays APPROVED with no payment, and retries answer `alreadyHandled`. |
| P7 | High | `settlement.ts:190-200` (+293-303); `lib/worker/credits.ts:66-82` | ANNUAL_PLAN invoice → one subscription with **all** sessions and period = now + 1 month; the expiry worker then expires ~11 months of prepaid sessions. `BillingSubscription` is written nowhere. |
| P8 | Medium | `settlement-seam.ts:63-73` | No reservation → deduction from the **latest** ACTIVE subscription (ignores consumption order); no subscription → nothing deducted and **no Admin flag** (CONTEXT §7 says settle + flag). |
| P9 | Medium | `settlement-seam.ts:118-137` | Two attended reports of one group session approved concurrently → second hits the unique index → unhandled 500 (no double pay, but the documented "P2002 = already settled" is not implemented). |
| P10 | Medium | `app/api/sessions/[id]/route.ts:49-66` | Session times/duration editable while reports are submitted; settlement reads the current duration → pay changes after the fact. |
| P11 | Medium | `settlement.ts:176` | A second successful payment on an already-PAID invoice is silently recorded as processed — no audit row, no Admin flag for the refund. |
| P12 | Medium (**needs sandbox**) | `paymob.ts:115` | `merchant_order_id = invoiceId` on every attempt; Paymob rejects duplicates → after the first attempt expires the invoice can't be paid online. |
| P13 | Medium | `app/api/payroll/{adjustments,disbursements}` | No idempotency key, no same-origin check, no currency-vs-teacher check → double click = two disbursements (append-only). |
| P14 | Medium | `lib/worker/credits.ts:30-40,88` | Batch of 100 ordered by `periodEndsAt`; subscriptions held ACTIVE by live reservations are re-picked every pass → with ≥100 of them newer ones never expire. |

What holds: integer minor units everywhere, half-up pay (`lib/payroll/rates.ts:14-16`), amount always from the Invoice row, HMAC SHA-512 + timing-safe compare, event claim + PAID + ledger + audit in one transaction, DB-level append-only triggers and partial unique indexes, Supervisor never receives amounts, USD path fails closed.

## Security / API — verified

| # | Sev | Where | Problem |
|---|---|---|---|
| S1 | High | 37 state-changing route handlers (list in the sub-review); `proxy.ts:65` passes `/api/*` through | No same-origin check (only 6 route files call `isSameOrigin`) — incl. admin users/roles, payroll, invoice creation, session links. Fix centrally in `proxy.ts` for non-GET `/api/*` (exclude webhook + `/api/auth`). |
| S2 | Medium | `app/api/admin/profiles/route.ts:21-22,40-41` | `roleConfig[type]` with unvalidated `type`: `?type=constructor` returns **every user** of the academy (incl. Admin/Supervisor usernames, phones, emails) to a Supervisor; POST → 500. |
| S3 | Medium | `prisma/seed-demo.ts:21` | The demo password (applied to all demo users **and the admin**) is committed in Git since `16cc458`. Rotate it if it is used anywhere else; move it to an env var. |
| S4 | Medium | 18 path ids + several GET query params | Not validated → Prisma UUID errors become unhandled 500s without the error shape. |
| S5 | Medium | `lib/request.ts` `errorResponse` + `auth/change-password` | Field errors under `fieldErrors`; ~33 routes use `fields`; the clients read both. |
| S6 | Medium | `checkout/route.ts:59` vs `invoices/*`, `student/invoices/page.tsx:36` | Finance wall implemented per route and inconsistent (`guardianId === null` vs `isAdult && !guardianId`). |
| S7 | Medium | `invoices/route.ts:105-166`; `lib/billing/pay-per-session.ts:53` (dead export) | Pay-per-session min/max (1/16) never enforced server-side. |
| S8 | Medium | `lib/validation/application.ts:5-11` | `normalizeEgyptPhone` mangles `201…`, `+49…`, `+1…` (seed already has +1/+966/+44 guardians); masked today by the Egypt-only regex — blocker for the WhatsApp slice. `lib/messaging/openwa-provider.ts:21-24` posts to `/api/sendText`, not the `POST /sessions/:id/messages/send-text` the OpenWA source exposes. |
| S9 | Low | `admin/users/[id]`, `admin/users` | Admin/Supervisor accounts always `mustChangePassword: false`, even after an admin-set password (confirm intent). |

No provider-interface bypass; no fake provider in production code. `z.guid()` only guards Postgres uuid keys (no tokens/idempotency keys) — no weakening; nothing strict remains. Minor: uppercase ids bypass the self-lockout guard in `admin/users/[id]` (self-harm only; LAST_ADMIN still enforced).

## Sessions 3–4 completion

| Item | Status |
|---|---|
| Payment audit + manual-payment UI hide | Done. Gaps: REJECTED stores the Admin's free-text note in metadata; audit silently skipped if the table is missing; 11 historical PAID invoices have no audit row (pre-audit, not backfilled — documented). |
| Evaluations, teacher-never-sees | Done — verified: no teacher page/route/payload/count/notification reaches them; Supervisor reads. |
| Bell on every page | Done (all role pages render `DashboardShell`). Comment claims "0 before migration" but the query would throw (client swallows it). |
| WhatsApp slice (d) | **Missing** — design only, awaiting owner approval. |
| `.env.example` (e) | Partial — `OPENWA_WEBHOOK_SECRET` and `ALLOWED_ORIGINS` missing; stale `MESSAGING_PROVIDER` still listed. |
| Cloudinary storage | Done (signed server uploads, `authenticated`, 300 s signed downloads, no URLs stored). 4 legacy Supabase rows remain. |
| Session completion | Done (row lock, same transaction, conditional update, no ledger writes). |

## Database audit (live DB, read-only)

- All **119 FKs `ON DELETE RESTRICT`**; append-only triggers on `subscription_ledger`, `payroll_ledger`, `payment_audit`; all timestamps `timestamptz`; only exchange-rate columns are `numeric`.
- Money consistency: **0** duplicate credits/deductions, **0** ledger rows without a settled report, **0** settled-attended reports without credit or deduction, **0** absent reports with money, **0** credit amount/minute mismatches, **0** negative balances, **0** PAID invoices without INITIAL_PURCHASE.
- Anomalies — all demo-seed rows (legacy `00000000-…` ids, written 2026-10-18 10:34):
  - 2 reports `APPROVED`/`ATTENDED` with `settled_at` NULL (seed wrote the status directly; no money moved).
  - 6 `SCHEDULED` sessions whose roster is fully reported (pre-date the completion rule — backfill is an owner decision).
  - 2 `SCHEDULED` roster rows without a credit reservation.
- Settings duplicates: `pay_per_session_max/min` **and** `billing.pay_per_session.max/min` both exist; `class_remark_options` vs the code key `report.class_remarks`.
- Schema ↔ DB drift (`prisma migrate diff`): `payment_audit.event_type/actor_role` and `session_evaluations.comment` are VARCHAR in the DB but plain String in Prisma; DESC indexes; ~15 FK/index names created by hand-written SQL differ from Prisma's names. A future `migrate dev` would generate a corrective migration — fix the schema (`@db.VarChar`, `map:`) rather than the DB.
- Missing indexes for current queries: `invoices(student_id, created_at)`, `notification_jobs(recipient_user_id, read_at)`, `teacher_flags(academy_id, flag_type)`.
- `webhook_events`, `payment_attempts`, `session_students`, `session_join_clicks`, `application_created_records` have no `academy_id` (child tables; SaaS hygiene only).
- `docs/specs/database-schema.md` documents none of `payment_audit`, `session_evaluations`, `notification_jobs.read_at`, storage columns.

## Proposed Stage 2 order (needs owner approval — nothing implemented)

1. **Payments safety (before any real payment):** P1, P3, P5, P6, P7 (block ANNUAL until monthly grants exist), then P2/P4/P12 against the Paymob sandbox.
2. **Security quick wins:** S1 central origin check, S2, S3, S6, S7.
3. **Performance quick wins (low risk):** Pool options, `relationJoins`, single icon-font source, scoped client messages, the 3 indexes, teacher-sessions date bound, instrumentation not blocking.
4. Schema drift fix + `database-schema.md` update; `.env.example`.
5. Open owner decisions: backfill the 6 demo sessions to COMPLETED?; demo-seed fix for the 2 unsettled approved reports; which pay-per-session settings key is authoritative; Admin `mustChangePassword`; WhatsApp design approval.
