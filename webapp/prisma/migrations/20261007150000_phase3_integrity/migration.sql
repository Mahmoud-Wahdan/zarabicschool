ALTER TYPE "SessionReservationStatus" ADD VALUE IF NOT EXISTS 'CONSUMED';
ALTER TYPE "SubscriptionLedgerEntryType" ADD VALUE IF NOT EXISTS 'EXPIRY';
ALTER TYPE "SubscriptionPackageType" ADD VALUE IF NOT EXISTS 'ANNUAL_PLAN';

CREATE TYPE "RecurrenceSeriesStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "NotificationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
CREATE TYPE "SessionChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "sessions"
  ADD COLUMN "recurrence_week_index" INTEGER,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "cancelled_by" UUID;

UPDATE "sessions" s
SET "created_by" = (
  SELECT u."id"
  FROM "users" u
  WHERE u."academy_id" = s."academy_id" AND u."role" IN ('ADMIN', 'SUPERVISOR')
  ORDER BY CASE WHEN u."role" = 'ADMIN' THEN 0 ELSE 1 END, u."created_at"
  LIMIT 1
);

ALTER TABLE "sessions" ALTER COLUMN "created_by" SET NOT NULL;

ALTER TABLE "subscription_ledger"
  ADD COLUMN "session_id" UUID,
  ADD COLUMN "report_id" UUID;

CREATE TABLE "recurrence_series" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "subject_id" UUID NOT NULL,
  "session_type" "SessionType" NOT NULL,
  "recurrence_rule" JSONB NOT NULL,
  "timezone" TEXT NOT NULL,
  "start_date" DATE NOT NULL,
  "total_weeks" INTEGER NOT NULL,
  "generated_through_week" INTEGER NOT NULL DEFAULT -1,
  "status" "RecurrenceSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "recurrence_series_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurrence_series_total_weeks_check" CHECK ("total_weeks" > 0),
  CONSTRAINT "recurrence_series_generated_week_check" CHECK ("generated_through_week" < "total_weeks")
);

CREATE TABLE "notification_jobs" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
  "status" "NotificationJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_change_requests" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "proposed_change" TEXT NOT NULL,
  "status" "SessionChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "session_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_recurrence_group_week_key"
  ON "sessions" ("recurrence_group_id", "recurrence_week_index");
CREATE UNIQUE INDEX "session_reservations_active_session_student_key"
  ON "session_reservations" ("session_id", "student_id")
  WHERE "status" = 'RESERVED';
CREATE UNIQUE INDEX "subscription_ledger_session_subscription_deduction_key"
  ON "subscription_ledger" ("session_id", "subscription_id")
  WHERE "entry_type" = 'SESSION_DEDUCTION';
CREATE INDEX "recurrence_series_academy_status_idx"
  ON "recurrence_series" ("academy_id", "status");
CREATE INDEX "recurrence_series_teacher_status_idx"
  ON "recurrence_series" ("teacher_id", "status");
CREATE UNIQUE INDEX "notification_jobs_session_recipient_kind_key"
  ON "notification_jobs" ("session_id", "recipient_user_id", "kind");
CREATE INDEX "notification_jobs_academy_status_schedule_idx"
  ON "notification_jobs" ("academy_id", "status", "scheduled_for");
CREATE INDEX "subscription_ledger_session_id_idx"
  ON "subscription_ledger" ("session_id");
CREATE INDEX "session_change_requests_academy_status_created_idx"
  ON "session_change_requests" ("academy_id", "status", "created_at");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sessions_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sessions_recurrence_group_fkey"
  FOREIGN KEY ("recurrence_group_id") REFERENCES "recurrence_series" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sessions_duration_check" CHECK ("duration_minutes" > 0 AND "duration_minutes" <= 720),
  ADD CONSTRAINT "sessions_time_order_check" CHECK ("scheduled_end" > "scheduled_start");

ALTER TABLE "subscription_ledger"
  ADD CONSTRAINT "subscription_ledger_session_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "subscription_ledger_report_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recurrence_series"
  ADD CONSTRAINT "recurrence_series_academy_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "recurrence_series_teacher_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "recurrence_series_subject_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "recurrence_series_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_jobs"
  ADD CONSTRAINT "notification_jobs_academy_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_jobs_session_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_jobs_recipient_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "session_change_requests"
  ADD CONSTRAINT "session_change_requests_academy_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_change_requests_session_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_change_requests_teacher_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "session_change_requests_reviewer_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "session_reservations"
  ADD CONSTRAINT "session_reservations_status_consistency_check"
  CHECK (("status" = 'RELEASED' AND "released_at" IS NOT NULL) OR ("status" IN ('RESERVED', 'CONSUMED') AND "released_at" IS NULL));

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Append-only ledger rows cannot be changed';
END;
$$;

CREATE TRIGGER subscription_ledger_append_only
BEFORE UPDATE OR DELETE ON "subscription_ledger"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
