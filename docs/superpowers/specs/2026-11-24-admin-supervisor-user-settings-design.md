# Shared User Settings — Design

## Intent

Give Admins and Supervisors one shared place to find and update users' account and
personal profile information, including username, display name, email, phone,
date of birth, preferred language, time zone, active status, and password resets.
The feature should make account-security actions explicit, invalidate sessions
after password changes, and notify account holders without exposing session secrets.

## Goals

- Let Admins manage accounts for every user role in their academy.
- Let Supervisors manage every account except Admin accounts.
- Keep account roles fixed in this feature; do not grant, remove, or change roles.
- Let an authorized manager reset another user's password. Store only its password
  hash, force the user to change it at next sign-in, and invalidate existing sessions.
- Invalidate all existing sessions after a user's self-service password change.
- Revoke sessions when an account is deactivated; reactivation must not make old
  sessions valid again.
- Record account updates, password resets/changes, session revocations, and
  activation-status changes, without recording cookies, JWTs, passwords, OTPs, or
  other credential values.
- Notify the affected account through the existing in-app inbox and WhatsApp
  channel after sensitive account changes. WhatsApp copy must be generic and contain
  only that account information changed plus a link to the website.
- Keep academic and financial data in their existing role-specific management pages.
- Preserve academy scoping, Arabic/English localization, RTL behavior, and existing
  profile constraints.

## Non-goals

- Viewing, copying, exporting, or persisting raw cookie or token values.
- Including usernames, changed field values, passwords, OTPs, or other account data
  in an account-security notification.
- Managing academic, guardian-relationship, teaching, scheduling, payroll, or
  financial records from the shared user directory.
- Changing user roles or impersonating another user.
- Adding a general session browser or suspicious-login monitoring dashboard.
- Replacing the existing self-service password-change flow.

## Constraints and current behavior

- `/admin/users` currently lists only Admin/Supervisor accounts and is Admin-only.
  Students, teachers, and guardians are managed from separate profile pages.
- Profile APIs already enforce academy boundaries and preserve role-specific
  invariants. The new directory must not bypass those APIs' rules for specialized
  profile data. This design expands the current Admin-only time-zone restriction
  for Supervisors; the announcements opt-out remains Admin-only.
- Authentication uses NextAuth JWT sessions with an eight-hour maximum age. There
  is no server-side active-session registry. Inactive users are rejected by the
  data-access layer, but password resets do not currently invalidate already-issued
  sessions.
- User passwords are bcrypt-hashed. Admin-set passwords already have audit fields
  (`passwordSetById` and `passwordSetAt`) and force a change for the account holder.
- The app has an in-app notification inbox and a WhatsApp worker behind
  `MessagingProvider`; notification jobs carry ids/enum values, not message text.
- The new page and every write endpoint must enforce the Admin/Supervisor boundary
  server-side. Hiding controls in the browser is not authorization.

## Approaches considered

1. **Shared user directory using the existing Admin Users page — selected.**
   Expand the current directory to all academy users and provide one account editor.
   Both roles get the same account-level fields, with the server excluding Admin
   targets from Supervisor reads and writes. Keep privileged-account creation
   Admin-only. This gives both roles one clear place to manage accounts without
   moving specialized academic or financial workflows.
2. **Extend each role-specific profile page.**
   Add account fields to the student, teacher, guardian, and privileged-account
   pages. This reuses current flows but leaves account management fragmented and
   gives Supervisors no single overview.

The shared directory was chosen for the requested central management experience.

## Proposed behavior

- Reuse `/admin/users` as the shared directory and expose it to Admins and
  Supervisors. The directory includes each account's username, name, role, email,
  phone, and active state. A search and role filter help locate accounts.
- Selecting an account opens an editor for common account/profile values. Role is
  read-only. Academic and financial fields remain on their existing pages.
- Admins can read and edit all academy accounts. Supervisors can read and edit
  non-Admin accounts only; an Admin target should be indistinguishable from not
  found to a Supervisor. Supervisors may edit all common account/profile values,
  including time zone, but cannot change the announcements opt-out. The privileged-
  account creation controls remain visible and usable only by Admins.
- Password reset is an explicit action, separate from ordinary profile saving.
  Require a new password of at least 12 characters, update the existing password
  audit fields, force a password change at next sign-in, and revoke prior sessions.
  Never return the password hash or the submitted password from an endpoint.
- A user's self-service password change also increments the session version and
  invalidates their existing sessions. The existing change-password form signs in
  again with the newly entered password, creating the new valid session.
- Provide a separate “Revoke sessions” action for an authorized manager.
  Deactivation also revokes sessions as part of the same atomic update. Reactivation
  does not restore any revoked session.
- Preserve the existing rule that a PENDING teacher cannot be activated until
  approved by an Admin.
- When changing a student's date of birth, preserve the current minor/guardian
  invariant: a student who is a minor must have a valid guardian; reject the update
  rather than leaving an invalid student profile.
- Prevent managers from deactivating, resetting, or revoking sessions for their
  own account through this management interface; personal password changes continue
  through the existing change-password flow.
- Log account-profile changes and security actions with actor, target, action, and
  timestamp only. Do not include field values, password values, OTPs, cookies, or
  tokens.
- Enqueue a generic in-app/WhatsApp account-security notice for sensitive account
  changes, resets, self-service password changes, session revocations, and status
  changes. The localized message says only that account information changed and
  links to the website login page.
- If the phone number changes, send the WhatsApp alert to the pre-update number;
  for other changes, send it to the current number. Use the old number only in
  memory for that send—never persist it in a notification payload. Keep an in-app
  notice if the WhatsApp send fails and report the delivery failure to the manager.
- Ensure the worker delivers these generic security notices even when the affected
  account has just been deactivated; other notification kinds keep their current
  active-account behavior.
- Do not add a session table or persist raw session values. Add a monotonically
  increasing per-user session version to the user record and include it in newly
  issued JWTs. Compare the JWT version with the current database value in the
  authenticated data-access path. Incrementing the version invalidates all older
  JWTs for that user. Missing version claims on pre-change tokens are treated as
  version zero.
- Persist a minimal security-event record (actor, target, action, timestamp) for
  password resets, session revocations, and deactivation-triggered revocations. It
  must not contain cookie, JWT, password, or token values.
- Keep existing account creation and role-specific profile editing behavior.
  Extend only the navigation/authorization necessary to let Supervisors reach the
  shared account directory.

## Acceptance criteria

- Admin can find and update account/profile fields for every role in the same
  academy, reset another user's password, and deactivate/reactivate accounts.
- Supervisors can find and update non-Admin accounts, including time zone, but
  cannot read or mutate an Admin account, reset an Admin password, or alter any
  role. The announcements opt-out remains Admin-only.
- Requests from unauthorized roles, cross-academy targets, malformed input, and
  invalid identifiers return explicit errors; client-side checks are not relied on.
- Password reset, explicit revocation, and deactivation invalidate the target's
  previously issued sessions. Password resets force a password change.
  Reactivation does not revive old sessions, and unchanged accounts' sessions
  remain valid.
- A PENDING teacher cannot be activated before Admin approval, and a student cannot
  be left without a guardian while under age.
- Security-event records identify the actor, target, action, and time, and contain
  no account field values, credentials, OTPs, or session values.
- Sensitive account changes create an in-app notice and a generic WhatsApp alert
  with a website link; phone-change alerts go to the old number. Failed WhatsApp
  delivery is surfaced without undoing the account update.
- Self-service password changes invalidate old sessions and establish a new session
  only through the existing credential sign-in flow.
- Arabic and English UI states, validation messages, empty/error states, and mobile
  layout are supported.
- Tests cover role boundaries, academy isolation, field validation, session
  invalidation, self-lockout protection, and secret-free responses/audit events.

## Implementation calls

- The stored session version and minimal audit metadata are not cookies or tokens;
  they are sufficient to revoke JWTs without saving their values.
- The shared directory is account/profile-only. Existing specialized pages remain
  authoritative for academic and financial records.
- Admin/Supervisor role assignment is intentionally outside this feature.
