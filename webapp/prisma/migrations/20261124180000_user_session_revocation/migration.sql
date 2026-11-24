-- Shared user settings (Task 1): version-based JWT session revocation and
-- minimal security-event audit log (actor, target, action, timestamp only).

ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "UserSecurityAction" AS ENUM (
  'ACCOUNT_UPDATED',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'SESSIONS_REVOKED',
  'ACCOUNT_DEACTIVATED',
  'ACCOUNT_ACTIVATED'
);

CREATE TABLE "user_security_events" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "action" "UserSecurityAction" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_security_events_target_user_id_idx" ON "user_security_events"("target_user_id");
CREATE INDEX "user_security_events_academy_id_created_at_idx" ON "user_security_events"("academy_id", "created_at");

ALTER TABLE "user_security_events"
  ADD CONSTRAINT "user_security_events_academy_id_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_security_events"
  ADD CONSTRAINT "user_security_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_security_events"
  ADD CONSTRAINT "user_security_events_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
