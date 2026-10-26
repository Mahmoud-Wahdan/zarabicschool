-- Phase 7 (owner decisions 2026-10-26): announcements + complaints. Additive; no
-- financial or attendance table is touched.

-- Announcements: Admin/Supervisor → everyone. WhatsApp delivery goes through
-- notification_jobs (kind ANNOUNCEMENT, payload {announcementId}); this row is the
-- in-app copy (dashboard widget until expires_at, history forever). A sent
-- announcement can never be edited or deleted (append-only trigger).
CREATE TABLE "announcements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "academy_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "whatsapp_recipient_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "announcements_title_check" CHECK (length(btrim("title")) >= 2),
  CONSTRAINT "announcements_body_check" CHECK (length(btrim("body")) >= 2),
  CONSTRAINT "announcements_expiry_check" CHECK ("expires_at" > "sent_at"),
  CONSTRAINT "announcements_recipient_count_check" CHECK ("whatsapp_recipient_count" >= 0)
);
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "announcements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "announcements_academy_sent_idx" ON "announcements"("academy_id", "sent_at" DESC);
CREATE INDEX "announcements_academy_expires_idx" ON "announcements"("academy_id", "expires_at");
CREATE TRIGGER "announcements_append_only"
BEFORE UPDATE OR DELETE ON "announcements"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Complaints: filed by a student, guardian or teacher about a party of ONE session.
-- Visible ONLY to Admin/Supervisor (server-enforced); the concerned party is never
-- notified automatically.
CREATE TYPE "ComplaintCategory" AS ENUM ('TEACHING_QUALITY', 'BEHAVIOUR', 'PUNCTUALITY', 'TECHNICAL', 'BILLING', 'OTHER');
CREATE TYPE "ComplaintStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');
CREATE TYPE "ComplaintPartyRole" AS ENUM ('TEACHER', 'STUDENT', 'GUARDIAN');

CREATE TABLE "complaints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "academy_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "filed_by_id" UUID NOT NULL,
  "filed_by_role" "ComplaintPartyRole" NOT NULL,
  "concerned_user_id" UUID NOT NULL,
  "concerned_role" "ComplaintPartyRole" NOT NULL,
  "category" "ComplaintCategory" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "status" "ComplaintStatus" NOT NULL DEFAULT 'NEW',
  "handled_by_id" UUID,
  "resolution_note" VARCHAR(4000),
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "complaints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "complaints_not_self_check" CHECK ("filed_by_id" <> "concerned_user_id"),
  CONSTRAINT "complaints_title_check" CHECK (length(btrim("title")) >= 2),
  CONSTRAINT "complaints_body_check" CHECK (length(btrim("body")) >= 2),
  -- RESOLVED ⇔ a resolution note + resolved_at; NEW has no handler yet.
  CONSTRAINT "complaints_resolution_check" CHECK (
    ("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL)
    AND ("status" <> 'RESOLVED' OR length(btrim(coalesce("resolution_note", ''))) >= 2)
    AND ("status" = 'NEW' OR "handled_by_id" IS NOT NULL)
  )
);
ALTER TABLE "complaints"
  ADD CONSTRAINT "complaints_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "complaints_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "complaints_filed_by_id_fkey" FOREIGN KEY ("filed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "complaints_concerned_user_id_fkey" FOREIGN KEY ("concerned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "complaints_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "complaints_academy_status_created_idx" ON "complaints"("academy_id", "status", "created_at" DESC);
CREATE INDEX "complaints_session_idx" ON "complaints"("session_id");
CREATE INDEX "complaints_concerned_user_idx" ON "complaints"("concerned_user_id");
