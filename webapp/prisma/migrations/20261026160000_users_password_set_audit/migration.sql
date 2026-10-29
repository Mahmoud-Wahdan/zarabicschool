-- Phase 6 slice B4 (S9): who/when last set a password ADMINISTRATIVELY (audit only;
-- no password data). Set when an Admin creates a privileged account or resets a
-- password; the forced change itself uses the existing must_change_password flag.
-- Additive, nullable, no backfill.

ALTER TABLE "users" ADD COLUMN "password_set_by_id" UUID;
ALTER TABLE "users" ADD COLUMN "password_set_at" TIMESTAMPTZ(6);

ALTER TABLE "users"
  ADD CONSTRAINT "users_password_set_by_id_fkey"
  FOREIGN KEY ("password_set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Both or neither.
ALTER TABLE "users"
  ADD CONSTRAINT "users_password_set_audit_check"
  CHECK (("password_set_by_id" IS NULL) = ("password_set_at" IS NULL));
