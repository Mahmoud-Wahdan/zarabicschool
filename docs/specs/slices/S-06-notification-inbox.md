# S-06 — Notification inbox (D12)

> Plan row: `phase-09-plan.md` S-06. Skills: superpowers:test-driven-development, frontend-design + impeccable (detector), superpowers:verification-before-completion.

## Design (4fec4ba)
- SQL S-4 (`20261028120000_notification_reads`, new table, ids-only keys, not financial; applied): per-user read state of team-queue items.
- `lib/notifications/inbox.ts` (computed, never stored; 14-day window): own notification jobs for every role (read = `notification_jobs.read_at`; never CREDENTIALS or EVALUATION* kinds); staff also get applications NEW, reports SUBMITTED, outage requests PENDING, complaints NEW/IN_PROGRESS (staff only), missing reports (D50 derivation) and teacher flags. Money kinds reach the Admin only (filtered again for the Supervisor).
- `GET /api/notifications`, `POST /api/notifications/read` (`{all:true}` or up to 200 validated keys; only the viewer's own jobs).
- The bell counts unread inbox items (`badge.inbox`) and opens `/notifications`; no ack on click any more.
- `/notifications`: one list, New then Earlier, a title per kind (ar/en), mark all as read; opening an item marks it read.

## Log
- 2026-10-28: NT-01..06, INB-01..03 (every composed kind has a title); affected suites 203/203; detector clean.
