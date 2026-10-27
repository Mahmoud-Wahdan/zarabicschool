# Time-zone audit — every date/time input and render (2026-10-27)

> Trigger: owner screenshot — the Admin reschedule form showed "New start (UTC)", opened empty and parsed in UTC while the list showed Cairo. Rule now (D48): inputs pre-fill the stored UTC instant in the **viewer's stored zone**, parse back in it and name it on the label; every render passes an explicit zone. Commits 1a36fe0, 360e7cc. Tests TZ-01..05, ZF-01..05. Skills: superpowers:systematic-debugging, superpowers:test-driven-development.

## Inputs (parse / pre-fill / label) — before → after
| Place | Parse | Pre-fill | Label |
|---|---|---|---|
| Admin sessions — create single/series | chosen zone (default viewer) | empty (new) | none → **chosen zone**; the zone list has no UTC entry |
| Admin sessions — list filters from/to | viewer | empty | none → **viewer** |
| Admin sessions — **reschedule** | session's stored zone (UTC for one session) → **viewer** | empty → **stored instant in the viewer zone**; an unchanged field keeps its exact instant | "(UTC)" → **viewer** |
| Session requests — replacement time | browser → session zone (1a36fe0) → **viewer** | browser → **viewer** | none → **viewer** |
| Payroll — rate effective from | browser → **viewer** (1a36fe0) | empty | aria-label only |
| Announcements — expiry date | browser end of day → **viewer end of day** (1a36fe0) | default | date only |
| Reports queue — date filters | server zone → **viewer days** (1a36fe0) | URL value | date only |
| Apply form — date of birth | UTC date (age only) | — | date only (no zone involved) |
| API: session create / series / replacement / request review | a missing zone defaulted to **"UTC"** → **creator's stored zone** | — | — |

## Renders (zone used)
- All `formatSessionDateTime(…, user.timezone, …)` calls (student, guardian, teacher and admin pages, complaints, announcements, evaluations, overtime, payroll): viewer — unchanged.
- **21 bare `Intl.DateTimeFormat` renders → viewer zone** (they used the host or browser zone): admin applications list + detail, billing, enrollments panel, financials (2), Admin dashboard "today" times, payment audit, admin payroll, admin session detail (3), guardian invoices, student invoices, Supervisor dashboard times, teacher monthly reports, teacher payroll, admin invoices panel, reports queue panel, session requests panel.
- Admin session detail header: the label showed the session's stored zone next to times rendered in the viewer zone → now the viewer zone.
- WhatsApp messages: recipient's zone (unchanged). Teacher dashboard/sessions, click timeline, dashboard clock: explicit zone (unchanged).
- Guard: ZF-03 fails if any `Intl.DateTimeFormat` in app/ or lib/ lacks a `timeZone`.

## Data note (not changed)
- One SCHEDULED session in the seed academy has `timezone = 'UTC'` (stored by the old default). Its times now display and edit correctly (viewer zone); its stored zone matters only for weekly-series generation, and it is a single session. Not modified (no data writes outside tests).
