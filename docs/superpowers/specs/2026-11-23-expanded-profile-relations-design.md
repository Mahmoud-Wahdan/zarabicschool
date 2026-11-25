# Expanded Operational Profiles Design

## Intent

The Admin and Supervisor profile tables for students, guardians, and teachers must show the operational relationships behind each account, not just basic account fields.

## Goals

- For students: show date of birth, age, adult/minor status, guardian and relationship, active subject/teacher assignments, finance summary, and account status.
- For guardians: show guardian relationship, linked children, each child's adult/minor status and active subject/teacher assignments.
- For teachers: show approval status, taught subjects, and students assigned to each subject.
- Keep relationship details available on demand through an accessible expandable row.
- Support RTL Arabic and LTR English plus Light and Dark themes using existing Tailwind and `z-*` design tokens.
- On mobile, preserve labels and avoid horizontal page overflow; the table may adapt to stacked rows.

## Non-goals

- No changes to assignment, guardian, invoice, or account business rules.
- No edits to relationships directly from this table.
- No historical ended assignments in the default relationship view.
- No new database tables or migrations.

## Approach

The existing `GET /api/admin/profiles?type=...` becomes the read model. It will query only the academy of the authenticated Admin/Supervisor and include named subject, guardian, student, teacher, and assignment relations. Active assignments are included; ended assignments remain hidden.

The existing `ProfilesPanel` remains the shared operational surface. It receives richer row data and renders role-specific summary columns plus native `<details>/<summary>` relationship disclosures. A semantic table is retained on desktop. On narrow screens it uses stacked row blocks with visible labels; no page-level horizontal overflow is allowed.

The UI uses existing StatusBadge, WhatsApp phone link, dark-mode tokens, `Cairo/Tajawal` Arabic and `Montserrat` English conventions already present in the app. The preview uses no invented claims or values beyond demonstrative names.

## Data contract

- Every row retains `id`, `username`, `displayName`, `phone`, `email`, `isActive`, and role profile data.
- A student row includes `dateOfBirth`, `guardian`, `activeAssignments`, and existing `financeStatus`.
- A guardian row includes `relationship` and `students` with name, adult status, and active assignments.
- A teacher row includes `subjects` and `studentsBySubject` with student names and assignment status.
- Subject names use locale-appropriate `nameAr` or `nameEn`.

## Constraints

- Admin/Supervisor authorization remains required.
- Academy scope remains mandatory on every relationship query.
- The birth-date age calculation remains UTC-date based and does not alter the stored birth date.
- Arabic is the default and English remains complete.
- The table must be keyboard and screen-reader accessible.

## Approval

Approved for implementation as an expandable operational relationship table, matching the supplied preview, with Light and Dark themes.
