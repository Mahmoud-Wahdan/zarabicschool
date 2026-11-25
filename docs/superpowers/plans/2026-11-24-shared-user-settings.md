# Shared User Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Admin/Supervisor user directory for secure account/profile management and revocable JWT sessions.

**Architecture:** Reuse `/admin/users` as the shared directory and its existing API paths for account listing and updates, while keeping privileged-account creation Admin-only. Add a per-user session version checked by the database-backed auth layer, and a minimal security-event table that records actions without storing credentials or token values.

**Tech Stack:** Next.js 16 App Router, NextAuth JWT sessions, Prisma/PostgreSQL, Zod, Next-intl, Jest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-admin-supervisor-user-settings-design.md`

## Global Constraints

- Admins can read and edit all users in their academy; Supervisors can read and edit non-Admin users only.
- Roles remain fixed in account updates; privileged-account creation remains Admin-only.
- Supervisors can edit all common account/profile fields, including time zone; announcement opt-out remains Admin-only.
- Manager-issued passwords are at least 12 characters and force a change at next sign-in.
- Password reset, self-service password change, explicit session revocation, and deactivation invalidate existing sessions; reactivation never restores them.
- Do not persist or display raw cookie, JWT, password, or token values.
- Audit events store actor/target/action/time only; no account values, credentials, OTPs, cookies, or tokens.
- Send a generic in-app and WhatsApp account-change notice with a website login link; never include field values or credentials. For phone changes, send to the old number without persisting it.
- A PENDING teacher cannot be activated until Admin approval; students under age must retain a valid guardian.
- Keep academic/financial workflows in their existing pages, and preserve Arabic/English localization, RTL, and academy scoping.
- Before editing Next.js files, read the relevant guides under `webapp/node_modules/next/dist/docs/`, as required by `webapp/AGENTS.md`.

## Review Focus

- A Supervisor must never enumerate or mutate an Admin account; pin this in `tests/admin-users-route.test.ts` with a filtered list assertion and Admin-target 404.
- A request from another academy or with an attempted role change must not mutate a user; pin this in `tests/admin-users-route.test.ts` with 404 and 400 assertions respectively.
- A stale JWT must fail after its account's session version changes, while an unchanged account remains valid; pin this in `tests/session-version.test.ts` and `tests/auth-session-version.test.ts`.
- A password reset/deactivation must revoke prior sessions without leaking secrets; pin this in `tests/admin-users-route.test.ts` and `tests/admin-profiles-route.test.ts` by asserting version/audit writes and credential-free responses.
- Student and teacher invariants must survive account edits; pin this in `tests/admin-users-route.test.ts` with minor-without-guardian and PENDING-teacher activation cases.

---

### Task 1: Add version-based session revocation

**Files:**
- Modify: `webapp/prisma/schema.prisma`
- Create: `webapp/prisma/migrations/20261124180000_user_session_revocation/migration.sql`
- Create: `webapp/lib/auth/session-version.ts`
- Modify: `webapp/lib/auth.ts`
- Modify: `webapp/lib/dal.ts`
- Create: `webapp/tests/session-version.test.ts`
- Create: `webapp/tests/auth-session-version.test.ts`
- Modify: `docs/specs/database-schema.md`

**Interfaces:**
- Produces `isSessionVersionCurrent(tokenVersion: number | undefined, currentVersion: number): boolean`; a missing token claim means version `0`.
- Adds `User.sessionVersion: Int @default(0)` and `UserSecurityEvent` with academy, actor, target, action, and timestamp fields. Actions are `ACCOUNT_UPDATED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`, `SESSIONS_REVOKED`, `ACCOUNT_DEACTIVATED`, and `ACCOUNT_ACTIVATED`.
- Authenticated data access rejects a session when its token version differs from the current user row.

- [ ] **Step 1: Write failing session-version tests.**
  In `tests/session-version.test.ts`, assert missing/zero/current versions are accepted only when equal to the stored version and an older version is rejected. In `tests/auth-session-version.test.ts`, mock NextAuth and Prisma to verify `getAuthSession` returns `null` for a stale token and accepts a matching version.
- [ ] **Step 2: Run the focused tests and confirm they fail.**

  Run from `webapp`: `npm test -- --runInBand tests/session-version.test.ts tests/auth-session-version.test.ts`

  Expected: FAIL because the comparison helper and version-aware auth check are not implemented.
- [ ] **Step 3: Add the database fields and migration.**
  Add `sessionVersion` and `UserSecurityEvent` to Prisma; add the integer column with default `0`, the security-event table, actor/target/academy foreign keys, and indexes for target and academy/time queries in the migration. Add the event action values for account updates, password reset/change, session revocation, and account activation/deactivation. Update the database schema document.
- [ ] **Step 4: Add the auth version helper and wire JWT issuance/checking.**
  Add `sessionVersion` to NextAuth `User`, `JWT`, and `Session` types. Select the DB version during credential authorization, copy it into new JWTs, and compare it with the current DB version in `getAuthSession`. Treat an absent claim as `0`. Make `getSessionUserId` use the validated auth session rather than reading the raw NextAuth session directly.
- [ ] **Step 5: Generate Prisma and run focused tests.**

  Run from `webapp`: `npm run db:generate` and `npm test -- --runInBand tests/session-version.test.ts tests/auth-session-version.test.ts`

  Expected: Prisma client generation succeeds and all version tests pass.
- [ ] **Step 6: Commit the session-revocation foundation.**

  ```bash
  git add webapp/prisma/schema.prisma webapp/prisma/migrations/20261124180000_user_session_revocation/migration.sql webapp/lib/auth/session-version.ts webapp/lib/auth.ts webapp/lib/dal.ts webapp/tests/session-version.test.ts webapp/tests/auth-session-version.test.ts docs/specs/database-schema.md
  git commit -m "feat: add revocable user sessions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

### Task 2: Secure account-management APIs

**Files:**
- Modify: `webapp/lib/validation/management.ts`
- Modify: `webapp/app/api/admin/users/route.ts`
- Modify: `webapp/app/api/admin/users/[id]/route.ts`
- Create: `webapp/app/api/admin/users/[id]/password/route.ts`
- Create: `webapp/app/api/admin/users/[id]/sessions/revoke/route.ts`
- Modify: `webapp/app/api/admin/profiles/[id]/route.ts`
- Create: `webapp/lib/notifications/security-notices.ts`
- Modify: `webapp/tests/admin-profiles-route.test.ts`
- Create: `webapp/tests/admin-users-route.test.ts`

**Interfaces:**
- `GET /api/admin/users` returns safe, academy-scoped directory fields for all roles; Supervisor results exclude Admins.
- `PATCH /api/admin/users/:id` updates only account/profile fields; it rejects `role` and password values.
- `POST /api/admin/users/:id/password` resets a target password, forces a change at next login, increments `sessionVersion`, and creates a `PASSWORD_RESET` event.
- `POST /api/admin/users/:id/sessions/revoke` increments `sessionVersion` and creates a `SESSIONS_REVOKED` event.
- `POST /api/admin/users` remains Admin-only for privileged account creation.
- Every protected page/API relies on the server-side version check in `getAuthSession`, not a frontend-only check.
- `recordAccountSecurityEvent(tx: Prisma.TransactionClient, input: { academyId: string; actorUserId: string; targetUserId: string; action: UserSecurityAction; inAppOnly?: boolean })` writes the audit event and an `ACCOUNT_SECURITY_NOTICE` notification job in the same transaction, returning `{ eventId: string; notificationJobId: string }`. The event and job carry no account values or credentials.
- `UserSecurityAction` is the event-action union declared by the Prisma schema; notification jobs persist only target/actor ids and the notice kind.

- [ ] **Step 1: Write failing API tests.**
  Add tests for Supervisor directory filtering, Supervisor Admin-target 404, cross-academy 404, role-change rejection, Supervisor time-zone update, Supervisor announcement-opt-out 403, Admin account updates, self-reset/deactivation/revoke protection, password reset and explicit revocation version increments, credential-free responses/events, pending-teacher activation rejection, the student minor/guardian invariant, and atomic security-event/notification-job writes.
- [ ] **Step 2: Run the focused API tests and confirm the new cases fail.**

  Run from `webapp`: `npm test -- --runInBand tests/admin-users-route.test.ts tests/admin-profiles-route.test.ts`

  Expected: new tests fail until route and schema behavior is implemented.
- [ ] **Step 3: Add account-update validation.**
  Define a dedicated partial schema for editable account/profile fields. Use the login-compatible username range (3–30 characters), the existing 12–128 password reset policy, valid email/phone bounds, valid preferred-language choices, and `isValidTimeZone`. Keep `announcementsOptOut` in the schema but authorize it for Admin only. Reject unknown keys, especially `role` and `password` on profile PATCH.
- [ ] **Step 4: Expand the directory GET and account PATCH with server-side role checks.**
  Scope every query by `academyId`; for Supervisors filter Admin targets from list and target lookups. Keep Admin-only account creation. Allow Supervisors to update timezone for non-Admin targets; keep announcements opt-out Admin-only. Preserve last-active-Admin protection, pending-teacher approval protection, self-deactivation protection, and conflict handling for duplicate username/email.
- [ ] **Step 5: Implement password-reset and session-revocation routes.**
  Require same-origin requests and Admin/Supervisor roles. Apply the same academy/role target boundary as PATCH and reject self-targets. Hash the supplied password with bcrypt cost 12; atomically update password audit fields, `mustChangePassword`, `sessionVersion`, the security event, and its notification job. Explicit revocation atomically increments the version and writes its event/job. Never select or return password hashes or credential values.
- [ ] **Step 6: Apply session invalidation and consistent timezone policy to existing profile updates.**
  In `app/api/admin/profiles/[id]/route.ts`, allow Supervisors to change timezone for the already-restricted non-Admin target roles. Keep announcements opt-out Admin-only. Continue setting the existing `timezoneSource` to `ADMIN` for manager-set overrides, and update its comment to clarify that it means academy-managed, not actor identity. When an active account is deactivated or an inactive account is activated, write the corresponding security event and notification job; deactivation also increments the session version in the same transaction. Keep the PENDING teacher and minor/guardian invariants intact.
- [ ] **Step 7: Run focused API and session tests.**

  Run from `webapp`: `npm test -- --runInBand tests/admin-users-route.test.ts tests/admin-profiles-route.test.ts tests/session-version.test.ts tests/auth-session-version.test.ts`

  Expected: all tests pass, including the Review Focus cases.
- [ ] **Step 8: Commit the API behavior.**

  ```bash
  git add webapp/lib/validation/management.ts webapp/app/api/admin/users/route.ts "webapp/app/api/admin/users/[id]/route.ts" "webapp/app/api/admin/users/[id]/password/route.ts" "webapp/app/api/admin/users/[id]/sessions/revoke/route.ts" "webapp/app/api/admin/profiles/[id]/route.ts" webapp/lib/notifications/security-notices.ts webapp/tests/admin-profiles-route.test.ts webapp/tests/admin-users-route.test.ts
  git commit -m "feat: secure shared user management APIs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

### Task 3: Notify users and revoke sessions on password changes

**Files:**
- Modify: `webapp/lib/notifications/security-notices.ts`
- Modify: `webapp/lib/notifications/inbox.ts`
- Modify: `webapp/lib/worker/notifications.ts`
- Modify: `webapp/app/api/admin/users/[id]/route.ts`
- Modify: `webapp/app/api/admin/profiles/[id]/route.ts`
- Modify: `webapp/app/api/me/profile/route.ts`
- Modify: `webapp/app/api/me/timezone/route.ts`
- Create: `webapp/tests/me-timezone-route.test.ts`
- Modify: `webapp/app/api/auth/change-password/route.ts`
- Modify: `webapp/tests/admin-users-route.test.ts`
- Modify: `webapp/tests/admin-profiles-route.test.ts`
- Modify: `webapp/tests/me-profile-route.test.ts`
- Create: `webapp/tests/change-password-route.test.ts`
- Create: `webapp/tests/security-notifications.test.ts`
- Modify: `webapp/messages/en.json`
- Modify: `webapp/messages/ar.json`

**Interfaces:**
- `recordAccountSecurityEvent(tx, input)` records the event and enqueues the generic in-app/WhatsApp notice transactionally.
- `composeAccountSecurityNotice(language: "ar" | "en", loginUrl: string): string` produces only generic account-change copy and the supplied website link.
- `sendPhoneChangeNotice(input: { notificationJobId: string; userId: string; oldPhone: string; language: "ar" | "en" }): Promise<{ status: "SENT" | "FAILED" }>` sends to the pre-update number in memory and stores delivery status without storing that number.
- WhatsApp notice content is localized, generic, and contains only that account information changed plus a website login link.
- A phone-number change sends WhatsApp to the old number in memory; the previous number is never persisted in a notification payload.
- Self-service password changes increment `sessionVersion`, write a `PASSWORD_CHANGED` event, enqueue a notice, and then the existing sign-in flow establishes the fresh session.

- [ ] **Step 1: Write failing tests for profile/password notifications.**
  Test manager and self-service account/profile edits enqueue an in-app/WhatsApp notice only when values change; test all phone-change paths send to the old number without storing it; test password change atomically writes `PASSWORD_CHANGED`, increments `sessionVersion`, and creates the notice job; test `composeAccountSecurityNotice` includes a website login link but no changed values or secrets; test worker sends security notices to deactivated users.
- [ ] **Step 2: Run the focused tests and confirm they fail.**

  Run from `webapp`: `npm test -- --runInBand tests/me-profile-route.test.ts tests/me-timezone-route.test.ts tests/change-password-route.test.ts tests/security-notifications.test.ts`

  Expected: new notification and password-revocation assertions fail until the flows are wired.
- [ ] **Step 3: Complete the security-notice helper and in-app inbox integration.**
  Write only the event action and target/actor ids into the audit record; write only ids/enum data into the notification job. Add `ACCOUNT_SECURITY_NOTICE` to inbox routing and the English/Arabic inbox title. Route the in-app item to the localized login page.
- [ ] **Step 4: Add generic WhatsApp composition and delivery behavior.**
  Compose a localized message with no account values and a link to the website login page. For normal account changes, use the existing notification worker. Allow only `ACCOUNT_SECURITY_NOTICE` jobs to be delivered when the recipient is inactive. Update manager and self-service account/profile handlers so phone changes use the old phone in memory for a direct send, keep the in-app job, do not persist a phone snapshot, and return a generic WhatsApp delivery failure state without rolling back the account update.
- [ ] **Step 5: Revoke sessions and notify on self-service account changes.**
  In `app/api/me/profile/route.ts` and `app/api/me/timezone/route.ts`, audit and notify only actual changes. In `app/api/auth/change-password/route.ts`, use one transaction to update the hash, `passwordChangedAt`, `sessionVersion`, event, and notification job. Preserve the existing `signIn` with the newly entered password so the current browser receives a new-version session after every old session is invalidated.
- [ ] **Step 6: Run the focused tests.**

  Run from `webapp`: `npm test -- --runInBand tests/me-profile-route.test.ts tests/me-timezone-route.test.ts tests/change-password-route.test.ts tests/security-notifications.test.ts tests/admin-users-route.test.ts tests/admin-profiles-route.test.ts tests/session-version.test.ts tests/auth-session-version.test.ts`

  Expected: self-service and manager actions invalidate old sessions and deliver safe notices without recording secrets.
- [ ] **Step 7: Commit notification and self-service security behavior.**

  ```bash
  git add webapp/lib/notifications/security-notices.ts webapp/lib/notifications/inbox.ts webapp/lib/worker/notifications.ts "webapp/app/api/admin/users/[id]/route.ts" "webapp/app/api/admin/profiles/[id]/route.ts" webapp/app/api/me/profile/route.ts webapp/app/api/me/timezone/route.ts webapp/app/api/auth/change-password/route.ts webapp/tests/admin-users-route.test.ts webapp/tests/admin-profiles-route.test.ts webapp/tests/me-profile-route.test.ts webapp/tests/me-timezone-route.test.ts webapp/tests/change-password-route.test.ts webapp/tests/security-notifications.test.ts webapp/messages/en.json webapp/messages/ar.json
  git commit -m "feat: notify users of account security changes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

### Task 4: Build the shared user settings directory

**Files:**
- Modify: `webapp/app/[locale]/admin/users/page.tsx`
- Modify: `webapp/app/[locale]/admin/users/privileged-users-panel.tsx`
- Modify: `webapp/app/_components/dashboard-shell.tsx`
- Modify: `webapp/proxy.ts`
- Modify: `webapp/messages/en.json`
- Modify: `webapp/messages/ar.json`
- Create: `webapp/tests/user-settings-panel.test.tsx`

**Interfaces:**
- The page loads the same safe account fields as `GET /api/admin/users` and is reachable by Admin and Supervisor roles.
- The panel offers search/filter, profile editing, account activation, explicit password reset, and explicit session revocation. Role is displayed read-only.
- Admin-only privileged-account creation stays available only to Admins.

- [ ] **Step 1: Write failing panel tests** in `tests/user-settings-panel.test.tsx`.
  Verify account edits call `PATCH`, password reset calls only the password route and never echoes the value in status text, password reset/deactivation/session revocation require confirmation, session revoke calls the revoke route, role is not editable, and a failed WhatsApp delivery is surfaced without claiming the alert was sent. Verify action controls are unavailable for the current user's reset/deactivation/revoke actions and for Admin rows viewed as Supervisor.
- [ ] **Step 2: Run the focused component test and confirm it fails.**

  Run from `webapp`: `npm test -- --runInBand tests/user-settings-panel.test.tsx`

  Expected: FAIL until the shared account editor and actions are added.
- [ ] **Step 3: Update the page loader and role navigation.**
  Use `requireRoles(["ADMIN", "SUPERVISOR"])`; load all academy accounts for Admins and only non-Admin accounts for Supervisors. Add `/admin/users` to the Supervisor sidebar and explicitly allow that route in `proxy.ts`; keep all other Admin-only routes unchanged.
- [ ] **Step 4: Refactor the panel into the account directory.**
  Render a searchable/filterable responsive account list with role/status labels and an accessible edit dialog. Include username, display name, email, phone, date of birth, preferred language, time zone, active status, and Admin-only announcements opt-out. Make role read-only. Keep privileged-account creation Admin-only.
- [ ] **Step 5: Add separate security actions and localized states.**
  Add separate, confirmed password-reset, deactivation, and “Revoke All Sessions” actions. Enforce the 12-character minimum in the form while relying on server validation. Surface any phone-change WhatsApp delivery failure without showing the phone number or message data. Add Arabic and English labels, pending/success/error messages, confirmation copy, and safe-action help text; use existing design tokens and RTL patterns.
- [ ] **Step 6: Run the panel, API, and type checks.**

  Run from `webapp`: `npm test -- --runInBand tests/user-settings-panel.test.tsx tests/admin-users-route.test.ts tests/admin-profiles-route.test.ts tests/me-profile-route.test.ts tests/me-timezone-route.test.ts tests/change-password-route.test.ts tests/security-notifications.test.ts tests/session-version.test.ts tests/auth-session-version.test.ts` and `npm run typecheck`

  Expected: all selected tests pass and TypeScript reports no errors.
- [ ] **Step 7: Commit the shared directory.**

  ```bash
  git add "webapp/app/[locale]/admin/users/page.tsx" "webapp/app/[locale]/admin/users/privileged-users-panel.tsx" webapp/app/_components/dashboard-shell.tsx webapp/proxy.ts webapp/messages/en.json webapp/messages/ar.json webapp/tests/user-settings-panel.test.tsx
  git commit -m "feat: add shared user settings directory" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

### Task 5: Align documentation and verify the feature

**Files:**
- Modify: `docs/specs/database-schema.md`
- Modify: `docs/specs/phase-02-educational-management.md`
- Modify: `docs/specs/business-model.md`
- Modify: `docs/CONTEXT.md`
- Modify: `docs/specs/phase-09-decisions.md`
- Modify: `docs/specs/slices/S-03-time-zone.md`

- [ ] **Step 1: Update role and session documentation.**
  Document that Admins manage all users, Supervisors manage non-Admin accounts (including Supervisor accounts), roles are fixed in the editor, timezone edits are available to Supervisors, and announcement opt-out stays Admin-only. Document `session_version`, the security-event table, generic in-app/WhatsApp account-change notices, old-number phone-change alerts, and that no token/cookie values are persisted.
- [ ] **Step 2: Run full focused validation.**

  Run from `webapp`: `npm test -- --runInBand`, `npm run lint`, and `npm run typecheck`.

  Expected: all Jest tests (including existing authentication/profile flows), lint, and typecheck pass.
- [ ] **Step 3: Review the final diff for access-control and secret-handling regressions.**
  Confirm every protected page/API validates through the server-side version check; every target query is academy-scoped; every Supervisor path excludes Admin targets; no update schema accepts a role; no response/log/audit/notification record includes account field values, a password, OTP, cookie, or JWT; and phone-change delivery uses only the old number in memory.
- [ ] **Step 4: Commit documentation and verification updates.**

  ```bash
  git add docs/specs/database-schema.md docs/specs/phase-02-educational-management.md docs/specs/business-model.md docs/CONTEXT.md docs/specs/phase-09-decisions.md docs/specs/slices/S-03-time-zone.md
  git commit -m "docs: describe shared account management" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```
