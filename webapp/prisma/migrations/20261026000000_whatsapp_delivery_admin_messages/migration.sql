-- WhatsApp slice (d) (owner-approved design, phase-06 Session 3 + Session 5 amendments).
-- FILE ONLY — the owner applies it from webapp/ with DIRECT_URL.

-- 1) Delivery tracking on notification_jobs, written ONLY by the signed
--    POST /api/whatsapp/status webhook (message.ack / message.failed).
--    Ids and statuses only — never message content.
ALTER TABLE "notification_jobs" ADD COLUMN "provider_message_id" VARCHAR(255) NULL;
ALTER TABLE "notification_jobs" ADD COLUMN "delivery_status" VARCHAR(16) NULL;
ALTER TABLE "notification_jobs" ADD COLUMN "delivery_updated_at" TIMESTAMPTZ(6) NULL;

ALTER TABLE "notification_jobs"
  ADD CONSTRAINT "notification_jobs_delivery_status_check"
  CHECK ("delivery_status" IS NULL OR "delivery_status" IN ('SENT', 'DELIVERED', 'READ', 'FAILED'));

CREATE INDEX "notification_jobs_provider_message_id_idx"
ON "notification_jobs" ("provider_message_id");

-- 2) Admin individual messages. The free-text body lives ONLY here, so
--    notification_jobs.payload keeps its redaction rule ({ adminMessageId }).
CREATE TABLE "admin_messages" (
  "id" UUID NOT NULL,
  "academy_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_messages_body_not_blank" CHECK (length(btrim("body")) > 0)
);

ALTER TABLE "admin_messages"
  ADD CONSTRAINT "admin_messages_academy_id_fkey"
  FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_messages"
  ADD CONSTRAINT "admin_messages_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_messages"
  ADD CONSTRAINT "admin_messages_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "admin_messages_academy_created_idx" ON "admin_messages" ("academy_id", "created_at" DESC);
CREATE INDEX "admin_messages_recipient_idx" ON "admin_messages" ("recipient_user_id");

-- 3) Initial site WhatsApp contact number (owner decision: initial 01060814239,
--    Admin-editable afterwards, never hardcoded in code). Existing values win.
INSERT INTO "academy_settings" ("id", "academy_id", "key", "value", "updated_at")
SELECT gen_random_uuid(), a."id", 'site.whatsapp_number', '"01060814239"'::jsonb, CURRENT_TIMESTAMP
FROM "academies" a
ON CONFLICT ("academy_id", "key") DO NOTHING;
