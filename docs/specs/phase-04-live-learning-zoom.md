# Phase 4 — Live Learning (Zoom)

## Goal

Zoom integration for live sessions. (CONTEXT.md §13, Phase 4; §6 for full details.)

Implement the small manual-link experience: Admin edits the pasted Zoom link, and authorized teachers/students open it through a safe redirect.

## Proposed approach

1. **Manual link management:** Admin edits the session link or recurrence copy.
2. **Session Experience (External Zoom Link):**
   - Display a private "Join Zoom" button/link for the assigned participant.
   - Open the Zoom desktop app, native mobile app, or Zoom browser experience externally.
   - Return the participant to the platform after the meeting for the teacher report flow.
3. **Optional click evidence:** A redirect logs session/user/time only, never the URL.

Delivery stage: Stage 2.

## Acceptance criteria

- Authorized users can open the correct link on desktop and mobile; Admin can edit it per session.

## Frontend

Routes: `/admin/sessions/:id/link`, role session lists, and a `Join Zoom` icon button. Loading, empty, error, mobile, and RTL states are required.

## Backend

PATCH `/api/sessions/:id/link`; GET `/api/sessions/:id/join` performs authorization then redirects. Validate URLs with Zod and return 400/401/403/404. Click logging is optional.

## Database

Touches `Sessions.zoom_join_url` and optional `zoom_host_url`; optional `SessionJoinClicks`. No Zoom API tables, tokens, events, registrations, recordings, or participant IDs.

## Auth & Authorization

| Role | Edit link | Open assigned link | View unrelated link |
|---|---:|---:|---:|
| Admin | Yes | Yes | Yes |
| Teacher | No | Assigned only | No |
| Student/Guardian | No | Authorized only | No |

## Security

Do not log URLs or query parameters; authorize before redirect; validate external URL scheme/host policy; rate-limit redirects; never expose host links to students.

## Transactions & failure handling

Link edits are atomic. A failed optional click insert must not prevent a valid redirect, and must not disclose the link in an error.

## Tests

Unit: URL validation. Integration: unauthorized redirect, missing link, Admin edit, optional click row, and no URL logging. Playwright: mobile/desktop authorized join flow.

## Learning checkpoint

- Why must authorization happen before issuing a redirect?

## Open decisions

- Merge this small phase into Phase 3 or Phase 5.
- Store host link and retain optional click logging.

## Deferred / Post-MVP

- [DEFERRED] Future Zoom API verification layer.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [ ] Implement private "Join Zoom" button/link for assigned participants on all devices
- [ ] [MVP] Add Admin per-session link editing and authorized redirect
- [ ] [PROPOSAL/OPTIONAL] Log redirect clicks without storing the link
- [ ] REMOVED — Zoom technical spike, OAuth, REST creation, registrants, WebSocket, event keys, embedded SDK, Redis/BullMQ Zoom bootstrap, and reconciliation.

## Execution log (updated as soon as real work happens)

(empty for now)
