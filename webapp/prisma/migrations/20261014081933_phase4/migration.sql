-- DropForeignKey
ALTER TABLE "student_teacher_assignments" DROP CONSTRAINT "student_teacher_assignments_teacher_subject_fkey";

-- AlterTable
ALTER TABLE "student_teacher_assignments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "notification_jobs" RENAME CONSTRAINT "notification_jobs_academy_fkey" TO "notification_jobs_academy_id_fkey";

-- RenameForeignKey
ALTER TABLE "notification_jobs" RENAME CONSTRAINT "notification_jobs_recipient_fkey" TO "notification_jobs_recipient_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "notification_jobs" RENAME CONSTRAINT "notification_jobs_session_fkey" TO "notification_jobs_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "recurrence_series" RENAME CONSTRAINT "recurrence_series_academy_fkey" TO "recurrence_series_academy_id_fkey";

-- RenameForeignKey
ALTER TABLE "recurrence_series" RENAME CONSTRAINT "recurrence_series_subject_fkey" TO "recurrence_series_subject_id_fkey";

-- RenameForeignKey
ALTER TABLE "recurrence_series" RENAME CONSTRAINT "recurrence_series_teacher_fkey" TO "recurrence_series_teacher_id_fkey";

-- RenameForeignKey
ALTER TABLE "session_change_requests" RENAME CONSTRAINT "session_change_requests_academy_fkey" TO "session_change_requests_academy_id_fkey";

-- RenameForeignKey
ALTER TABLE "session_change_requests" RENAME CONSTRAINT "session_change_requests_reviewer_fkey" TO "session_change_requests_reviewed_by_fkey";

-- RenameForeignKey
ALTER TABLE "session_change_requests" RENAME CONSTRAINT "session_change_requests_session_fkey" TO "session_change_requests_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "session_change_requests" RENAME CONSTRAINT "session_change_requests_teacher_fkey" TO "session_change_requests_teacher_id_fkey";

-- RenameForeignKey
ALTER TABLE "sessions" RENAME CONSTRAINT "sessions_recurrence_group_fkey" TO "sessions_recurrence_group_id_fkey";

-- RenameForeignKey
ALTER TABLE "subscription_ledger" RENAME CONSTRAINT "subscription_ledger_report_fkey" TO "subscription_ledger_report_id_fkey";

-- RenameForeignKey
ALTER TABLE "subscription_ledger" RENAME CONSTRAINT "subscription_ledger_session_fkey" TO "subscription_ledger_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "teacher_flags" RENAME CONSTRAINT "teacher_flags_academy_fkey" TO "teacher_flags_academy_id_fkey";

-- RenameForeignKey
ALTER TABLE "teacher_flags" RENAME CONSTRAINT "teacher_flags_session_fkey" TO "teacher_flags_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "teacher_flags" RENAME CONSTRAINT "teacher_flags_teacher_fkey" TO "teacher_flags_teacher_id_fkey";

-- RenameIndex
ALTER INDEX "notification_jobs_academy_status_schedule_idx" RENAME TO "notification_jobs_academy_id_status_scheduled_for_idx";

-- RenameIndex
ALTER INDEX "recurrence_series_academy_status_idx" RENAME TO "recurrence_series_academy_id_status_idx";

-- RenameIndex
ALTER INDEX "recurrence_series_teacher_status_idx" RENAME TO "recurrence_series_teacher_id_status_idx";

-- RenameIndex
ALTER INDEX "session_change_requests_academy_status_created_idx" RENAME TO "session_change_requests_academy_id_status_created_at_idx";

-- RenameIndex
ALTER INDEX "sessions_recurrence_group_week_key" RENAME TO "sessions_recurrence_group_id_recurrence_week_index_key";

-- RenameIndex
ALTER INDEX "teacher_flags_session_flag_type_key" RENAME TO "teacher_flags_session_id_flag_type_key";

-- RenameIndex
ALTER INDEX "teacher_flags_teacher_created_idx" RENAME TO "teacher_flags_teacher_id_created_at_idx";
