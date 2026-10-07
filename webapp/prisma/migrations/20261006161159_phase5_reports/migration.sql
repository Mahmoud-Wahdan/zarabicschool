-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('SESSION_COMPLETION_REPORT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'REJECTED', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttendanceOutcome" AS ENUM ('ATTENDED', 'STUDENT_ABSENT');

-- CreateEnum
CREATE TYPE "ExtraTimeStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "academy_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "attendance_outcome" "AttendanceOutcome" NOT NULL,
    "class_remark" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "homework" TEXT NOT NULL,
    "notes" TEXT,
    "operational_events" JSONB,
    "extra_time_minutes" INTEGER NOT NULL DEFAULT 0,
    "extra_time_status" "ExtraTimeStatus" NOT NULL DEFAULT 'NONE',
    "extra_time_reviewed_by" UUID,
    "extra_time_reviewed_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejection_reason" TEXT,
    "rejected_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "settled_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_academy_id_status_submitted_at_idx" ON "reports"("academy_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "reports_teacher_id_status_idx" ON "reports"("teacher_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reports_session_id_student_id_report_type_key" ON "reports"("session_id", "student_id", "report_type");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_extra_time_reviewed_by_fkey" FOREIGN KEY ("extra_time_reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
