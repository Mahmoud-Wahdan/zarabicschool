# Phase 8 — Testing & Launch

## Goal

Bug fixing, UX polish, performance, launch prep. (CONTEXT.md §13, Phase 8.)

Execute comprehensive end-to-end testing across onboarding, manual Zoom links, teacher reports, Admin approval, atomic settlement, manual billing, and launch readiness.

## Proposed approach

1. **End-to-End test suite:**
   - Playwright test flows for application submission -> approval -> credential login.
   - Report submission -> Admin approval -> explicit attendance -> ledger settlement tests.
   - Idempotency stress test: replay duplicate settlement requests to verify zero duplicate ledger rows.
   - Rollback test when the second ledger insert fails; retry must be safe.
   - Rejection/resubmission, completed-session-plus-missing-report, and archived-report immutability tests.
2. **UX & accessibility audit:**
   - Arabic RTL polish across all viewports (mobile, tablet, desktop).
   - Typography consistency (Cairo/Tajawal for Arabic, Montserrat for English).
   - Brand color compliance check (#1B365D Navy, #00897B Emerald, #D4AF37 Gold).
3. **Security & secret audit:**
   - Ensure zero secrets committed in Git history or environment files.
   - Verify server-side authorization checks on all mutations and API endpoints.
   - Verify rate limiting and input sanitization (Zod).
4. **Production deployment:**
   - Finalize production hosting setup for Next.js web application and required long-running worker process.
   - Verify Supabase production connection pooling (`DATABASE_URL` with transaction mode, `DIRECT_URL` for migrations).
   - Execute dry-run migration and seed in staging/production.

Delivery stage: Spans Stages 1–3.

## Acceptance criteria

- Each stage has a documented handoff gate; auth, reports, ledgers, uploads, backups, and authorization tests pass.

## Frontend

Run Playwright across login, applications, sessions, reports, invoices, payroll, and Admin queues at mobile/desktop Arabic RTL and English states, including loading/empty/error paths.

## Backend

Run authorization, Zod validation, rate-limit, idempotency, health-check, notification-after-commit, and error-shape checks. Hosting is decided at deployment.

## Database

Use real Postgres; verify raw SQL indexes/triggers/checks, backup/restore, `DIRECT_URL` migrations, and ledger consistency queries.

## Auth & Authorization

Audit every route by Role × Action, including deactivated sessions, minor data, signed uploads, Zoom redirects, reports, and financial mutations.

## Security

Verify no passwords, Zoom links, secrets, or student-identifying data in logs; rotate secrets; review uploads, rate limits, dependencies, authorization, and backups.

## Transactions & failure handling

Run concurrent report submits, unique-violation behavior, rollback injection, post-commit notifications, and restore verification.

## Tests

Unit, real-Postgres integration, RTL/component, and Playwright E2E suites include Admin approval before settlement, rejection/resubmission, completed-plus-missing-report, archive immutability, duplicate settlement, and rollback. No Zoom API/event lifecycle tests.

## Learning checkpoint

- Which checks must pass before handing Stage 2 to the client?
- Why is restore verification different from checking that backups exist?

## Open decisions

Hosting, stage dates, scheduler, and unresolved domain choices from earlier phases.

## Deferred / Post-MVP

- [DEFERRED] SaaS roadmap, Zoom verification, SMS, and recordings. Payment gateways are MVP scope: Paymob is the EGP provider and USD remains unavailable until a concrete provider is configured.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, deployment runbook, backup/restore evidence, and execution log are complete.

## Tasks

- [ ] Write Playwright E2E tests for student onboarding flow
- [ ] Write integration test suite for report submission -> Admin/Supervisor approval -> attendance -> settlement
- [ ] Run automated idempotency verification for duplicate settlement requests
- [ ] Run rejection/resubmission, missing-report, archive-immutability, and rollback tests
- [ ] Conduct full Arabic RTL responsive UI audit
- [ ] Audit application for proper error boundaries and user feedback
- [ ] Run security check on role authorization barriers across all routes
- [ ] Audit environment variables and ensure `.env.example` is complete
- [ ] Set up production monitoring, error logging, and health checks
- [ ] Execute production deployment and verify live end-to-end functionality

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom WebSocket lifecycle, event replay, and reconciliation tests.
- [MVP] Launch verification centers on approval-gated settlement, explicit attendance, immutable archives, manual links, authorization, uploads, backups, and staged handoffs.

### 2026-10-06 reconciliation

- Phase 8 remains Not Started. Playwright coverage, real-Postgres settlement/idempotency/rollback evidence, RTL/accessibility review, security audit, backup/restore verification, monitoring, and deployment runbook are not complete.
- Payment gateway verification belongs to the launch gate; it is not deferred. The browser checkout return is not authoritative, and signed provider events must be verified before invoice settlement.
