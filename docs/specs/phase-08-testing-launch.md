# Phase 8 — Testing & Launch

## Goal

Bug fixing, UX polish, performance, launch prep. (CONTEXT.md §13, Phase 8.)

Execute comprehensive end-to-end testing across critical business paths (especially live Zoom session lifecycle, automated payroll idempotency, and manual billing), refine Arabic/English RTL UX, perform security audit, and prepare production deployment.

## Proposed approach

1. **End-to-End test suite:**
   - Playwright test flows for application submission -> approval -> credential login.
   - Simulation tests for Zoom WebSocket events -> attendance logging -> payroll accrual.
   - Idempotency stress test: replay duplicate `meeting.ended` events to verify zero duplicate ledger rows.
   - Disconnect recovery test: verify BullMQ reconciliation catches missed sessions.
2. **UX & accessibility audit:**
   - Arabic RTL polish across all viewports (mobile, tablet, desktop).
   - Typography consistency (Cairo/Tajawal for Arabic, Montserrat for English).
   - Brand color compliance check (#1B365D Navy, #00897B Emerald, #D4AF37 Gold).
3. **Security & secret audit:**
   - Ensure zero secrets committed in Git history or environment files.
   - Verify server-side authorization checks on all mutations and API endpoints.
   - Verify rate limiting and input sanitization (Zod).
4. **Production deployment:**
   - Finalize production hosting setup for Next.js web application and long-running worker process (Zoom WebSocket client, OpenWA, BullMQ).
   - Verify Supabase production connection pooling (`DATABASE_URL` with transaction mode, `DIRECT_URL` for migrations).
   - Execute dry-run migration and seed in staging/production.

## Tasks

- [ ] Write Playwright E2E tests for student onboarding flow
- [ ] Write integration test suite simulating full Zoom event lifecycle (start -> join -> end -> payroll)
- [ ] Run automated idempotency verification test (duplicate event injection)
- [ ] Verify BullMQ reconciliation worker under simulated WebSocket disconnect
- [ ] Conduct full Arabic RTL responsive UI audit
- [ ] Audit application for proper error boundaries and user feedback
- [ ] Run security check on role authorization barriers across all routes
- [ ] Audit environment variables and ensure `.env.example` is complete
- [ ] Set up production monitoring, error logging, and health checks
- [ ] Execute production deployment and verify live end-to-end functionality

## Execution log (updated as soon as real work happens)

(empty for now)
