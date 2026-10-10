-- Scheduling assignments (Phase 3, batch 1) — schema only.
-- student_subjects: which subjects a student studies (idempotent per pair).
-- student_teacher_assignments: who teaches whom for which subject (scheduling prerequisite).
-- sessions: override-audit columns for Admin/Supervisor assignment overrides.
-- No data backfill is included in this migration.

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "student_subjects" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_teacher_assignments" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "ended_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_subjects_student_id_subject_id_key" ON "student_subjects"("student_id", "subject_id");

-- CreateIndex
CREATE INDEX "student_subjects_academy_id_idx" ON "student_subjects"("academy_id");

-- CreateIndex
CREATE INDEX "student_teacher_assignments_academy_id_status_idx" ON "student_teacher_assignments"("academy_id", "status");

-- CreateIndex
CREATE INDEX "student_teacher_assignments_student_id_status_idx" ON "student_teacher_assignments"("student_id", "status");

-- CreateIndex
CREATE INDEX "student_teacher_assignments_teacher_id_status_idx" ON "student_teacher_assignments"("teacher_id", "status");

-- CreateIndex
CREATE INDEX "student_teacher_assignments_subject_id_idx" ON "student_teacher_assignments"("subject_id");

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite FK (raw SQL; Prisma cannot express it): an assignment may exist only
-- where the teacher already teaches the subject (teacher_subjects is UNIQUE(teacher_id, subject_id)).
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_teacher_subject_fkey" FOREIGN KEY ("teacher_id", "subject_id") REFERENCES "teacher_subjects"("teacher_id", "subject_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index (raw SQL; Prisma cannot express it): one ACTIVE assignment per
-- (student, teacher, subject); ENDED rows remain as history.
CREATE UNIQUE INDEX "idx_student_teacher_assignments_active" ON "student_teacher_assignments"("student_id", "teacher_id", "subject_id") WHERE "status" = 'ACTIVE';

-- AlterTable: override-audit columns on sessions (raw SQL section kept next to its CHECK)
ALTER TABLE "sessions" ADD COLUMN "assignment_overridden_by_id" UUID,
    ADD COLUMN "assignment_override_reason" TEXT;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_assignment_overridden_by_id_fkey" FOREIGN KEY ("assignment_overridden_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK (raw SQL): the override reason is mandatory and non-blank exactly when an
-- override happened (both columns set together, or neither).
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_assignment_override_audit_check" CHECK (
    ("assignment_overridden_by_id" IS NULL AND "assignment_override_reason" IS NULL)
    OR
    ("assignment_overridden_by_id" IS NOT NULL AND "assignment_override_reason" IS NOT NULL AND btrim("assignment_override_reason") <> '')
);
