-- Session 5 schema hardening (owner-approved direct fixes, 2026-10-25).
-- Applied on the freshly wiped dev DB, so the NOT NULL columns need no backfill.

-- academy_id on two tenant-owned child tables (CONTEXT §11 hygiene).
ALTER TABLE "session_join_clicks" ADD COLUMN "academy_id" UUID NOT NULL;
ALTER TABLE "session_join_clicks"
  ADD CONSTRAINT "session_join_clicks_academy_id_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "session_join_clicks_academy_id_idx" ON "session_join_clicks"("academy_id");

ALTER TABLE "application_created_records" ADD COLUMN "academy_id" UUID NOT NULL;
ALTER TABLE "application_created_records"
  ADD CONSTRAINT "application_created_records_academy_id_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "application_created_records_academy_id_idx" ON "application_created_records"("academy_id");

-- Send attempts can never be negative.
ALTER TABLE "notification_jobs"
  ADD CONSTRAINT "notification_jobs_attempts_check" CHECK ("attempts" >= 0);
