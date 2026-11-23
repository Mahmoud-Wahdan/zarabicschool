# Task 1 Report: Extend the Profile Read API Contract

## Status
Completed.

## Changes
- Added `webapp/lib/admin/profile-relations.ts` with pure role-specific profile relation mapping helpers.
- Extended `GET /api/admin/profiles` to select academy-scoped guardian, student, teacher, subject, and active assignment relations.
- Preserved existing approval, teacher flag, and finance behavior.
- Added `webapp/tests/profile-relations.test.ts` covering student guardians and active assignments, guardian-linked children, teacher subject/student grouping, and missing-DOB stored `isAdult` fallback.

## TDD Evidence
- Red: `npx tsx --test tests/profile-relations.test.ts` failed with `MODULE_NOT_FOUND` for `../lib/admin/profile-relations` before the module existed.
- Green: `npx tsx --test tests/profile-relations.test.ts` passed 4 tests.

## Verification
- Focused test: PASS (`4/4`).
- `npm run typecheck`: PASS with no TypeScript errors.

## Verification Commands
```powershell
cd webapp
npx tsx --test tests/profile-relations.test.ts
npm run typecheck
```

## Notes
- The mapper uses active assignments only (`status === "ACTIVE"`).
- Date of birth is serialized as `YYYY-MM-DD` or `null`.
- When DOB is present, adult/minor status uses the existing UTC birth-date helper.
- When DOB is absent, status uses the stored `Student.isAdult` value.
- All added nested relation queries remain scoped to `academyId` where applicable.

## Task 1 Review Finding Fix (2026-11-23)

- Updated the student branch of `GET /api/admin/profiles` to set `studentProfile.isAdult` from `relations.isAdult`.
- This keeps the DOB-calculated value when DOB exists and preserves the stored `Student.isAdult` fallback when DOB is null; no other response behavior was changed.
- Added a route-level regression test covering both cases in `webapp/tests/admin-profiles-route.test.ts`.
- TDD: the focused route test failed before the route change because the DOB-backed row returned the stored `false` value; it passed after the mapping was added.
- Verification: focused route test and `npm run typecheck` passed.
- Focused route test command: `npm test -- --runTestsByPath tests/admin-profiles-route.test.ts --runInBand '--setupFilesAfterEnv=<rootDir>/jest.setup.js'`.
- Existing profile-relations test: `npx tsx --test tests/profile-relations.test.ts` passed 4/4; typecheck command: `npm run typecheck`.
- The normal Jest setup references a missing ignored `tests/helpers/fake-messaging.setup.ts`; the focused route test was run with the available `jest.setup.js` instead. No setup/config files were changed.
