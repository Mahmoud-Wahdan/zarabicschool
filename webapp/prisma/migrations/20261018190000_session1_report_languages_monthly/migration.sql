-- Session 1 (owner, 2026-10-18): report languages + monthly reports + rejection counter.
-- Additive only. OWNER APPLIES from webapp/: npx prisma migrate deploy (uses DIRECT_URL).
-- Until applied: isSession1ReportsReady() degrades (monthly reports 409, language
-- selector + rejection counter self-hide, submit-time notices deferred) — no crashes.

-- CreateEnum
CREATE TYPE "ReportLanguage" AS ENUM ('ar', 'en', 'fr', 'de', 'tr');

-- CreateEnum
CREATE TYPE "MonthlyLearningProgress" AS ENUM ('EXCELLENT', 'VERY_GOOD', 'GOOD', 'VERY_SLOW_PROGRESS');

-- CreateEnum
CREATE TYPE "MonthlyEngagementBand" AS ENUM ('ALWAYS', 'OFTEN', 'SOMETIMES', 'RARELY');

-- CreateEnum
CREATE TYPE "MonthlyHomeworkBand" AS ENUM ('ALWAYS', 'MOST_OF_THE_TIME', 'SOMETIMES', 'RARELY');

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "language" "ReportLanguage" NOT NULL DEFAULT 'ar',
ADD COLUMN     "rejection_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "report_language" "ReportLanguage" NOT NULL DEFAULT 'ar';

-- AlterTable
ALTER TABLE "notification_jobs" ADD COLUMN     "payload" JSONB,
ADD COLUMN     "report_id" UUID;

-- CreateTable
CREATE TABLE "monthly_reports" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "month_key" VARCHAR(7) NOT NULL,
    "achievement" TEXT NOT NULL,
    "learning_progress" "MonthlyLearningProgress" NOT NULL,
    "class_focus" "MonthlyEngagementBand" NOT NULL,
    "homework_completion" "MonthlyHomeworkBand" NOT NULL,
    "punctuality" "MonthlyEngagementBand" NOT NULL,
    "rescheduled_sessions" INTEGER NOT NULL DEFAULT 0,
    "support_areas" TEXT,
    "next_month_objectives" TEXT,
    "language" "ReportLanguage" NOT NULL DEFAULT 'ar',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "monthly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_reports_academy_id_month_key_idx" ON "monthly_reports"("academy_id", "month_key");

-- CreateIndex
CREATE INDEX "monthly_reports_teacher_id_month_key_idx" ON "monthly_reports"("teacher_id", "month_key");

-- CreateIndex
CREATE INDEX "monthly_reports_student_id_idx" ON "monthly_reports"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_reports_teacher_id_student_id_month_key_key" ON "monthly_reports"("teacher_id", "student_id", "month_key");

-- CreateIndex
CREATE INDEX "notification_jobs_report_id_idx" ON "notification_jobs"("report_id");

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
