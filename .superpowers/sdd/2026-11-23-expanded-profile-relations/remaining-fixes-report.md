# Remaining Profile Relations Review Fixes

Date: 2026-11-23

## Resolved findings

1. Self-service profile updates now read the current `Student.isAdult` within the transaction and call `resolveAdultStatus`. A cleared DOB preserves the stored flag; a supplied DOB still determines adult status.
2. The DOB migration now backfills `students.is_adult` for every student with a migrated DOB using the age in years (`>= 18`). The backfill does not override the DOB-derived value based on guardian linkage; display mapping remains responsible for presenting DOB-derived status and the stored fallback.
3. Added a Jest route regression test proving that clearing DOB retains a stored `isAdult: true` value.
4. Moved the long-name wrapping assertion to the mobile viewport and scoped it to the mobile profile name element, rather than the desktop table's first matching text.

## Verification

- `npm run test:profile-relations` - passed, 6/6 Node tests.
- `npm test -- --setupFilesAfterEnv G:/programming/zarabicschool/webapp/jest.setup.js --runInBand` - passed, 2 Jest suites / 4 tests. The configured after-environment hooks had to be overridden because their referenced files are absent.
- `npm run typecheck` - passed.
- ESLint on `app/api/me/profile/route.ts`, `e2e/profile-relations.spec.ts`, and `tests/me-profile-route.test.ts` - passed.
- Playwright test discovery is blocked before discovery by the configured but absent `e2e/support/global-setup.ts`; the configured teardown file is absent too. The mobile browser assertion could not be executed.
- The migration was not run against a database.

## Confirmed test configuration gaps

- `webapp/jest.setup.js` exists. The Jest config's `setupFilesAfterEnv` paths `webapp/tests/helpers/fake-messaging.setup.ts` and `webapp/tests/helpers/db-timeouts.setup.ts` do not.
- The Playwright config points at `webapp/e2e/support/global-setup.ts` and `webapp/e2e/support/global-teardown.ts`; neither file exists.
- These gaps were documented only after checking the exact configured paths and observing the corresponding Jest/Playwright resolution errors. No speculative setup files or config edits were added.
