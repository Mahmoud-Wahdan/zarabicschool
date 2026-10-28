-- Phase 9 S-02 / SQL S-2 (D9, D38; teachers table, not financial; the owner allowed
-- the agent to apply migrations): a teacher added by a Supervisor is PENDING until
-- the Admin approves (and sets the rate). Existing teachers stay APPROVED.
ALTER TABLE "teachers" ADD COLUMN "approval_status" VARCHAR(16) NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_approval_status_check" CHECK ("approval_status" IN ('PENDING', 'APPROVED'));
ALTER TABLE "teachers" ADD COLUMN "approved_by" UUID;
ALTER TABLE "teachers" ADD COLUMN "approved_at" TIMESTAMPTZ(6);
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
