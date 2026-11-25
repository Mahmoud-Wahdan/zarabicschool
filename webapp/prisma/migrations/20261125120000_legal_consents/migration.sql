-- Legal & compliance consents (2026-11-25):
-- 1) Guardian / applicant data processing consent timestamp on applications.
-- 2) Customer subscription & refund policy consent timestamp on invoices.

ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "data_consent_at" TIMESTAMPTZ(6) NULL;

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "terms_consent_at" TIMESTAMPTZ(6) NULL;
