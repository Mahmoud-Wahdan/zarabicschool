-- Session 3, slice C: per-recipient unread tracking for the notification bell
-- (owner decision 2026-10-24). NULL read_at = not seen. Set ONLY by the viewer's
-- own ack action; the worker never touches it. Operator queue badges
-- (applications/reports/requests) are team queues and do not use this column.

ALTER TABLE "notification_jobs" ADD COLUMN "read_at" TIMESTAMPTZ(6) NULL;

-- Unread lookups are always per recipient and bounded by the two active statuses.
CREATE INDEX "notification_jobs_recipient_unread_idx"
ON "notification_jobs" ("recipient_user_id")
WHERE "read_at" IS NULL AND "status" IN ('PENDING', 'SENT');
