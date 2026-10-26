-- Missing monthly report flag (owner decision 7, 2026-10-26): reuse teacher_flags.
-- A LATE_REPORT flag points at a session; a MONTHLY_REPORT_MISSING flag points at a
-- (teacher, month) pair instead, so session_id becomes optional and month_key is added.
-- Additive: existing rows keep session_id set and month_key NULL.

ALTER TYPE "TeacherFlagType" ADD VALUE IF NOT EXISTS 'MONTHLY_REPORT_MISSING';

ALTER TABLE "teacher_flags" ALTER COLUMN "session_id" DROP NOT NULL;
ALTER TABLE "teacher_flags" ADD COLUMN "month_key" VARCHAR(7);

-- Exactly one anchor per flag: a session, or a well-formed month key.
-- (Does not reference the new enum value: it cannot be used in the transaction that adds it.)
ALTER TABLE "teacher_flags"
  ADD CONSTRAINT "teacher_flags_anchor_check" CHECK (
    ("session_id" IS NOT NULL AND "month_key" IS NULL)
    OR ("session_id" IS NULL AND "month_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  );

-- One month flag per (teacher, type, month); the worker inserts with ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX "teacher_flags_teacher_type_month_key"
  ON "teacher_flags"("teacher_id", "flag_type", "month_key")
  WHERE "month_key" IS NOT NULL;
