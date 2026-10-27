-- Phase 9 S-01 / D2 + D36 (owner, 2026-10-27; SQL S-1 APPROVED with one extra CHECK):
-- manual attendance resolution by the Admin (or the Supervisor within 7 days of the
-- scheduled end). ATTENDANCE table — created by the owner (this file is not applied
-- by the agent). Append-only audit row; one per roster entry. A correction is a new
-- subscription_ledger ADMIN_ADJUSTMENT, never an edit. No payroll_ledger write ever.
CREATE TABLE "attendance_resolutions" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "outcome" VARCHAR(20) NOT NULL,
  "reason" TEXT NOT NULL,
  "resolved_by" UUID NOT NULL,
  "resolved_by_role" VARCHAR(16) NOT NULL,
  "subscription_ledger_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_resolutions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_resolutions_outcome_check" CHECK ("outcome" IN ('ATTENDED', 'STUDENT_ABSENT')),
  CONSTRAINT "attendance_resolutions_role_check" CHECK ("resolved_by_role" IN ('ADMIN', 'SUPERVISOR')),
  CONSTRAINT "attendance_resolutions_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 1000),
  -- Owner's extra CHECK: an absence releases the reservation and never deducts.
  CONSTRAINT "attendance_resolutions_absent_no_ledger_check" CHECK ("outcome" <> 'STUDENT_ABSENT' OR "subscription_ledger_id" IS NULL)
);

CREATE UNIQUE INDEX "attendance_resolutions_session_student_key" ON "attendance_resolutions"("session_id", "student_id");
CREATE INDEX "attendance_resolutions_academy_created_idx" ON "attendance_resolutions"("academy_id", "created_at" DESC);

ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_resolutions" ADD CONSTRAINT "attendance_resolutions_ledger_fkey" FOREIGN KEY ("subscription_ledger_id") REFERENCES "subscription_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only audit, same trigger function as the ledgers.
CREATE TRIGGER attendance_resolutions_append_only BEFORE UPDATE OR DELETE ON "attendance_resolutions"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
