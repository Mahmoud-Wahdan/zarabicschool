-- AddForeignKey
ALTER TABLE "student_teacher_assignments" ADD CONSTRAINT "student_teacher_assignments_teacher_id_subject_id_fkey" FOREIGN KEY ("teacher_id", "subject_id") REFERENCES "teacher_subjects"("teacher_id", "subject_id") ON DELETE RESTRICT ON UPDATE CASCADE;
