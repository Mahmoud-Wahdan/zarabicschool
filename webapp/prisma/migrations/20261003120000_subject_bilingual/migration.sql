-- AlterTable
-- The init migration created the academy+name unique as a plain unique index
-- (CREATE UNIQUE INDEX), not a table constraint, so it must be dropped with DROP INDEX.
DROP INDEX "subjects_academy_id_name_key";

ALTER TABLE "subjects" ADD COLUMN "slug" TEXT;
ALTER TABLE "subjects" ADD COLUMN "name_ar" TEXT;
ALTER TABLE "subjects" ADD COLUMN "name_en" TEXT;
ALTER TABLE "subjects" ADD COLUMN "description_ar" TEXT;
ALTER TABLE "subjects" ADD COLUMN "description_en" TEXT;
ALTER TABLE "subjects" ADD COLUMN "icon" TEXT;
ALTER TABLE "subjects" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "subjects"
SET
  "slug" = COALESCE(NULLIF("slug", ''), 'subject-' || "id"::text),
  "name_ar" = COALESCE(NULLIF("name_ar", ''), "name"),
  "name_en" = COALESCE(NULLIF("name_en", ''), "name"),
  "description_ar" = COALESCE("description_ar", "description"),
  "description_en" = COALESCE("description_en", "description");

ALTER TABLE "subjects" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "subjects" ALTER COLUMN "name_ar" SET NOT NULL;
ALTER TABLE "subjects" ALTER COLUMN "name_en" SET NOT NULL;

ALTER TABLE "subjects" DROP COLUMN "name";
ALTER TABLE "subjects" DROP COLUMN "description";

CREATE UNIQUE INDEX "subjects_academy_id_slug_key" ON "subjects"("academy_id", "slug");
CREATE INDEX "subjects_academy_id_is_active_sort_order_idx" ON "subjects"("academy_id", "is_active", "sort_order");
