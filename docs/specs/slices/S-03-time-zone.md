# S-03 — Time zone from the device, the user or the Admin (D3, D39)

> Plan row: `phase-09-plan.md` S-03. Skills: superpowers:test-driven-development, impeccable (polish), superpowers:verification-before-completion.

## Design (4b24f54, 5080601)
- SQL S-3 (`20261028110000_users_timezone_source`, users, not financial; applied): `timezone_source` DEFAULT|DEVICE|USER|ADMIN.
- `POST /api/me/timezone` (every role, same-origin): DEVICE writes only while the source is DEFAULT/DEVICE (D39); USER always. Real IANA names only (`lib/users/timezone.ts`).
- Admin profile PATCH `timezone` → ADMIN; Supervisor 403.
- `DeviceTimeZoneSync` in the dashboard shell: reports `Intl...resolvedOptions().timeZone` once per browser session, refreshes when it changed.
- `/account` page (user-menu link): zone picker grouped by region, live local time, a note per source. Impeccable polish: hydration-safe first paint (zone list + clock from `useSyncExternalStore` after mount), no `aria-live` on the clock, DEFAULT note corrected.
- Display in the viewer zone and WhatsApp in the recipient zone were done in the time-zone audit (360e7cc, D48).
- Follow-up (not built): an Admin control for another user's zone in the profiles table (the API exists).

## Log
- 2026-10-28: TZS-01..06, TZF-01..03; security sweeps + related suites 165/165; detector clean.
