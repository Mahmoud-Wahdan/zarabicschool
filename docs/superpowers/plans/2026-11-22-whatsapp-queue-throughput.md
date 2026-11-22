# WhatsApp Queue Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase ordinary queued WhatsApp notification throughput to approximately 50 messages per minute under a continuously available queue.

**Architecture:** Keep the notification worker's 50-job batch limit, but reduce its shared inter-send pause from 1,500 ms to 1,000 ms. Leave announcement scheduling, per-invoice anti-repeat rules, direct Admin message limits, and the generic API request limiter unchanged.

**Tech Stack:** TypeScript, Next.js, Prisma, Jest.

**Spec:** `docs/superpowers/specs/2026-11-22-whatsapp-queue-throughput-design.md`

## Global Constraints

- Keep the ordinary worker batch limit at 50 jobs.
- Set the shared worker send spacing to 1,000 ms.
- Treat this as an application-side target, not a guarantee of OpenWA or WhatsApp capacity.
- Keep transient OpenWA 429 retry behavior; do not retry permanent failures.
- Do not change the generic API request limit, invoice-link anti-repeat rules, direct Admin message route quota, or announcement quotas.

## Review Focus

- A single ordinary notification must send without an unnecessary spacing delay; verify the focused worker test.
- Multiple ordinary notifications in one tick must use a 1,000 ms spacing delay; verify the focused worker test.
- OpenWA transient failures must retain their retry behavior; verify the existing retry coverage.
- Announcement-only per-tick, hourly, and daily quotas must remain unchanged; verify the announcement worker suite.
- Invoice-link anti-repeat responses and the generic API 429 behavior must remain unchanged; leave those surfaces untouched and verify via the focused diff.

---

### Task 1: Pace the ordinary notification queue

**Files:**
- Modify: `webapp/lib/worker/notifications.ts`
- Create: `webapp/tests/worker/notification-throughput.test.ts` (ignored by `webapp/.gitignore`; force-add this test file so the regression test is versioned)

**Interfaces:**
- Consumes: `processDueNotificationJobs(now: Date, academyId?: string)` and the existing fake messaging provider.
- Produces: The existing worker sender uses a 1,000 ms pause between consecutive sends; the 50-job ordinary batch and all other throttles remain unchanged.

- [ ] **Step 1: Write a failing worker test**
  - Create two due ordinary notification jobs for the test academy.
  - Spy on the timer used by the sender and verify the inter-send delay is 1,000 ms.
  - Verify both jobs are sent and marked `SENT`.
  - Add a one-job case asserting there is no inter-send delay.
- [ ] **Step 2: Run the focused test and verify the delay assertion fails against the current 1,500 ms implementation.**
  - Run: `npm --prefix webapp test -- --runTestsByPath tests/worker/notification-throughput.test.ts --runInBand --testMatch='**/tests/**/*.test.[jt]s?(x)'`
- [ ] **Step 3: Change only `SEND_SPACING_MS` to `1_000` in `webapp/lib/worker/notifications.ts`; leave `POLL_BATCH` at 50.**
- [ ] **Step 4: Run focused worker, retry, and announcement tests; run typecheck and scoped ESLint.**
  - Run: `npm --prefix webapp test -- --runTestsByPath tests/worker/notification-throughput.test.ts tests/worker/announcement-scheduling.test.ts tests/api/edge-cases.test.ts --runInBand --testMatch='**/tests/**/*.test.[jt]s?(x)'`
  - Run: `npm --prefix webapp run typecheck`
  - Run scoped ESLint for `webapp/lib/worker/notifications.ts` and the new test; report any known unrelated typecheck baseline failures without changing unrelated code.
- [ ] **Step 5: Commit the implementation and regression test.**
  - Commit message: `perf: increase WhatsApp queue throughput`
