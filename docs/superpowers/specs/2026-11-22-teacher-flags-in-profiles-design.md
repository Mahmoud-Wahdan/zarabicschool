# Teacher Flags in Profiles Design

## Intent
Let Admins and Supervisors see existing automated teacher flags in the teacher management list, so they can spot report follow-up needs without leaving profile management.

## Scope
- Add a read-only flags column to the existing shared profiles panel, shown only for teachers.
- Include each stored flag's type and context: the late session's date, or the month key for missing monthly reports.
- Reuse the current `ADMIN`/`SUPERVISOR` authorization on the profiles API and keep the data academy-scoped.
- Translate labels and dates for Arabic and English.

## Non-goals
- No flags are created for students or guardians; the schema currently has no such records.
- No manual flag creation, editing, resolution, or deletion.
- No change to worker rules, flag persistence, or profile access.

## Approaches
1. Extend the existing teacher profile API response and show read-only flag details in the existing table. Selected: smallest change, follows the existing list workflow and authorization.
2. Add a general flags system for teachers, students, and guardians. Deferred: requires new data model, flag lifecycle, and rules for who can create or resolve each type.

## Behavior
Show all stored teacher flags. `LATE_REPORT` is presented as a late session report with its session date; `MONTHLY_REPORT_MISSING` includes its month. These records persist historically, so the UI must not imply they are active or unresolved. Students and guardians have no flags column or empty-state label.

## Verification
Test the profile API response for both roles and academy scoping, render flags in Arabic and English, and run the existing profile and worker suites plus typecheck/lint. Use the existing Playwright setup only if a suitable local authenticated profile test is available; do not use a hosted deployment as the verification target.
