# Phase 7 — Admin & Reports

## Goal

Full admin dashboard, reporting, the evaluation/report feature (Section 9). (CONTEXT.md §13, Phase 7.)

Build the central analytics and administration dashboard, the announcements broadcast system, and the qualitative feedback loop: teacher reports on student progress, student/guardian evaluations of teachers, and automated post-session rating forms.

## Proposed approach

1. **Database migrations:** Add `Reports`, `Evaluations`, and `Announcements` tables to Prisma schema.
2. **Admin central dashboard:**
   - Operational metrics: active students, teachers, scheduled/completed sessions, pending applications, pending invoices.
   - Financial overview: total subscription collections vs. accrued teacher payroll liabilities.
3. **Qualitative reports system:**
   - Teacher interface to write progress reports on assigned students.
   - Student/Guardian interface to submit feedback/reports on teachers.
   - Role-scoped visibility for viewing submitted reports.
4. **Post-session evaluations:**
   - Automated trigger upon session completion presenting evaluation form to student.
   - Aggregated teacher evaluation ratings visible to Admin.
5. **Announcements management:**
   - Admin UI to compose announcements with target audience filters (`ALL`, `STUDENTS`, `TEACHERS`, `GUARDIANS`).
   - Feed component displayed on user dashboards according to role.

## Tasks

- [ ] Add Prisma schema: `Reports`, `Evaluations`, `Announcements`
- [ ] Run migration
- [ ] Build admin overview dashboard with operational and financial metrics
- [ ] Build teacher-to-student progress report form and listing
- [ ] Build guardian/student view of student progress reports
- [ ] Build student/guardian teacher evaluation submission interface
- [ ] Implement automated post-session evaluation prompt for students
- [ ] Build admin evaluation review and rating summaries
- [ ] Build admin announcements composer (target audience selection)
- [ ] Build dashboard announcements widget for Student, Guardian, and Teacher
- [ ] Write tests: reporting authorization, evaluation submission, announcement scoping

## Execution log (updated as soon as real work happens)

(empty for now)
