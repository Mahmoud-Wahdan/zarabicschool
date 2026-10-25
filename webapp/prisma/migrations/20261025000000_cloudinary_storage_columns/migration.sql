-- Cloudinary storage switch (owner, 2026-10-25). Files are private Cloudinary
-- "authenticated" assets; the DB keeps the object's identity, never a URL:
--   file_path        = provider object key (Cloudinary public_id; legacy Supabase path)
--   storage_provider = which provider holds the object
--   resource_type    = Cloudinary resource type (image / video / raw); NULL for legacy rows
--   format           = file format / extension
--   size_bytes       = bytes (existing column)
-- Existing rows were written to Supabase Storage and keep reading from there;
-- nothing is copied or deleted by this migration.

ALTER TABLE "report_attachments"
  ADD COLUMN "storage_provider" VARCHAR(20) NOT NULL DEFAULT 'supabase',
  ADD COLUMN "resource_type" VARCHAR(20) NULL,
  ADD COLUMN "format" VARCHAR(20) NULL;

ALTER TABLE "report_attachments"
  ADD CONSTRAINT "report_attachments_storage_provider_check"
  CHECK ("storage_provider" IN ('supabase', 'cloudinary')),
  ADD CONSTRAINT "report_attachments_cloudinary_resource_type_check"
  CHECK ("storage_provider" <> 'cloudinary' OR "resource_type" IN ('image', 'video', 'raw'));

ALTER TABLE "payment_proofs"
  ADD COLUMN "storage_provider" VARCHAR(20) NOT NULL DEFAULT 'supabase',
  ADD COLUMN "resource_type" VARCHAR(20) NULL,
  ADD COLUMN "format" VARCHAR(20) NULL;

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_storage_provider_check"
  CHECK ("storage_provider" IN ('supabase', 'cloudinary')),
  ADD CONSTRAINT "payment_proofs_cloudinary_resource_type_check"
  CHECK ("storage_provider" <> 'cloudinary' OR "resource_type" IN ('image', 'video', 'raw'));
