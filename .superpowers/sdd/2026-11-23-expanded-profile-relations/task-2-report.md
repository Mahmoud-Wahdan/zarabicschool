# Task 2 Report: Expand the Student Profile Table

## Status
Completed.

## Changes
- Extended `webapp/app/[locale]/admin/profiles-panel.tsx` for student rows with DOB, UTC age, adult/minor status, guardian name and relationship, and active subject/teacher assignments.
- Added native `<details>/<summary>` relationship disclosures with an accessible localized label in desktop and mobile layouts.
- Added Arabic and English locale keys under `management.form` for DOB, age/status, guardian/relationship, subjects/teachers, disclosure details, active assignments, and empty states.
- Preserved the existing account, finance, status, announcements, activate/deactivate, and create behavior.
- Added `webapp/e2e/profile-relations.spec.ts` focused on student DOB/age, guardian, assignment disclosure, keyboard toggling, and mobile overflow.

## Verification
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.
- Impeccable mechanical detector: completed; no findings file was emitted.
- Focused Playwright command was attempted, but the repository currently lacks `e2e/support/global-setup.ts` and `e2e/support/global-teardown.ts` referenced by `playwright.config.ts`, so the test runner could not start.

## Visual/Responsive Notes
- Desktop uses a semantic table.
- Mobile uses labeled stacked rows and details disclosures, with no horizontal-page-overflow composition.
- Existing `z-*` surface/border/status tokens and light/dark theme variables remain in use.
