-- Phase 9 S-06 / SQL S-4 (D12; new table, not financial; the owner allowed the agent
-- to apply migrations): per-user read state for inbox items that are team queues
-- (requests, reports to review, missing reports, complaints, applications, flags).
-- Item keys hold ids only, never names or text. A user's own notification jobs keep
-- using notification_jobs.read_at.
CREATE TABLE "notification_reads" (
  "user_id" UUID NOT NULL,
  "item_key" VARCHAR(200) NOT NULL,
  "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("user_id", "item_key")
);
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
