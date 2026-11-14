-- Migration: 20261102120000_application_teacher_media
-- Teacher application media: required intro video link + optional Quran recitation audio.
-- Additive nullable columns on the applications table.

BEGIN;

ALTER TABLE "applications"
  ADD COLUMN "intro_video_url" VARCHAR(500) NULL,
  ADD COLUMN "recitation_audio_path" VARCHAR(255) NULL,
  ADD COLUMN "recitation_audio_storage_provider" VARCHAR(20) NULL,
  ADD COLUMN "recitation_audio_resource_type" VARCHAR(20) NULL,
  ADD COLUMN "recitation_audio_format" VARCHAR(20) NULL,
  ADD COLUMN "recitation_audio_size_bytes" BIGINT NULL;

ALTER TABLE "applications"
  ADD CONSTRAINT "applications_recitation_audio_storage_provider_check"
  CHECK ("recitation_audio_storage_provider" IS NULL OR "recitation_audio_storage_provider" = 'cloudinary'),
  ADD CONSTRAINT "applications_recitation_audio_resource_type_check"
  CHECK ("recitation_audio_resource_type" IS NULL OR "recitation_audio_resource_type" = 'video'),
  ADD CONSTRAINT "applications_recitation_audio_size_check"
  CHECK ("recitation_audio_size_bytes" IS NULL OR "recitation_audio_size_bytes" > 0),
  ADD CONSTRAINT "applications_recitation_audio_all_or_nothing_check"
  CHECK (
    (
      "recitation_audio_path" IS NULL
      AND "recitation_audio_storage_provider" IS NULL
      AND "recitation_audio_resource_type" IS NULL
      AND "recitation_audio_format" IS NULL
      AND "recitation_audio_size_bytes" IS NULL
    )
    OR
    (
      "recitation_audio_path" IS NOT NULL
      AND "recitation_audio_storage_provider" IS NOT NULL
      AND "recitation_audio_size_bytes" IS NOT NULL
    )
  );

COMMIT;
