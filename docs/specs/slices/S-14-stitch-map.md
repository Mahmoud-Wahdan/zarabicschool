# S-14 — Stitch screens: map and order (D1, D71)

> Branch `phase9-rest`. Owner, 2026-10-29: map first, then page by page; keep Lucide icons (D71) instead of the Stitch icon font.

**Export:** `docs/stitch_zarabicschool_edtech_management_platform/` (30 screens: html + png; design tokens in `academic_precision/`, already in `app/globals.css`).

**Rule per page:**
- layout and components follow the export;
- our data, rules, roles, i18n (ar/en, RTL) and tests are kept;
- no fake data from the mock-up (names, "V2.8", "Stripe" and other made-up badges are not copied);
- one page per commit, checked in the browser and with the Impeccable detector.

**Status:** measured by the classes each page and panel uses ("Stitch kit" = `z-card` / `surface-container` / `text-headline` / `PageHeader` / `MetricTile` / `StatusBadge`; "old" = `dashboard-card` / `var(--navy)` / `var(--line)`).

| Stitch screen | App page | Status today |
|---|---|---|
| admin_operations_dashboard | /admin | Stitch kit (done) |
| supervisor_operations_dashboard_zarabicschool | /supervisor | Stitch kit (done) |
| report_approval_queue | /admin/reports (reports-queue-panel) | Stitch kit (done) |
| absence_replacement_management_zarabicschool | /admin/session-requests | Stitch kit (done) |
| billing_plan_configuration_suite | /admin/billing | Stitch kit (done) |
| financials_subscriptions_invoicing_suite | /admin/financials and /admin/invoices | **done (page 2)** |
| schedule_live_sessions + recurring_session_provisioning_zarabicschool | /admin/sessions (session-management-panel) | **done (page 1)** |
| applications_account_provisioning | /admin/applications (+ detail) | **done (page 3)** |
| people_accounts_directory_zarabicschool | /admin/students, teachers, guardians, users (profiles-panel, privileged-users-panel) | **done (page 5)** |
| teacher_payroll_hourly_rates_suite + monthly_payroll_closing_treasury_suite | /admin/payroll (panel + adjustments ledger) | **done (page 4)** |
| zarabicschool_1, 2, 3, 8 (landing, subjects, plans, about) | / (landing components) | Stitch kit (done) |
| zarabicschool_9 (login) | /login | done |
| zarabicschool_10 (mandatory password change) | /change-password | done |
| zarabicschool_5 (admission portal) | /apply | done |
| zarabicschool_4, 6, 7 (guardian / student / teacher application forms) | /apply?role=… (apply-form) | **done (page 8)** |
| zarabicschool_12 (teacher week) | /teacher/calendar | done |
| zarabicschool_13 (teacher reports) | /teacher/sessions | **done (page 6)** |
| zarabicschool_14 (teacher earnings) | /teacher/payroll | **done (page 6)** |
| zarabicschool_15 (guardian family home) | /guardian | **done (page 7)** |
| zarabicschool_16 (guardian reports + subscriptions) | /guardian/reports | **done (page 7)** |
| zarabicschool_17 (session evaluation prompt) | evaluation card on family homes | **done (page 7)** |
| zarabicschool_18, 19 (student home) | /student | **done (page 7)** |
| zarabicschool_11, academic_precision | png only (11 is a variant; academic_precision is the design system) | reference |

**Order** (owner, 2026-10-29: dashboard, sessions, reports queue, billing/invoices, payroll, people, family pages, landing):
1. Admin sessions.
2. Admin invoices.
3. Applications inbox.
4. Payroll.
5. People directory.
6. Teacher sessions and earnings.
7. Family pages (guardian, student, evaluation prompt).
8. Application forms.

**Log**
- 2026-10-29: map written.
- 2026-10-29: page 1 /admin/sessions on the Stitch kit: PageHeader instead of the navy banner; four real metric tiles (sessions today with done/upcoming from getTodaySessions, waiting change requests, paused series, same-link overlaps); cards, fields (z-input), buttons (btn), status chips and notes on Stitch tokens; no logic change. Not copied from the mock-up: Zoom API bridge %, biometric check-ins, Export ICS, Sync Rooms (not features of the app). Browser check (ar) done; detector clean. Found: the sidebar lit Dashboard on every Admin page (fixed in its own commit).
- 2026-10-29: page 2 /admin/invoices on the Stitch kit (PageHeader; invoices panel, refund form and refund-request list on kit cards, fields, buttons and tokens; no logic change). Checked on a production build (ar); detector clean. Note: a dev server started before a new migration must be restarted (its in-memory database client does not know the new tables).
- 2026-10-29: page 3 /admin/applications (list + detail, review, approve, credentials) on the Stitch kit; no logic change; applications suite green; detector clean.
- 2026-10-29: page 4 /admin/payroll (page, entry panel, adjustments ledger) on the Stitch kit; no logic change; payroll suites green; detector clean.
- 2026-10-29: page 5 people directory (students, teachers, guardians, privileged users) on the Stitch kit: PageHeader on each, kit cards/fields/buttons in both panels; no logic change; teacher-approval, WhatsApp link, RBAC suites green; detector clean.
- 2026-10-29: page 6 teacher pages (home, sessions, attendance, payroll, monthly reports, calendar and indicators headers, report and monthly forms, loading/error states) on the Stitch kit; the navy banners and plain headings became PageHeader; no logic change; indicators, report, zone, contrast, i18n suites green; detector clean.
- 2026-10-29: page 7 family pages (guardian and student home, sessions, attendance, reports, invoices, report view, loading/error) and the shared evaluation card, renewal panel, charge-date rail, payment panel, refund-request button, calendar on the Stitch kit; banners and plain headings became PageHeader; no logic change; renewal, refund-request, flag, evaluation, calendar, zone, contrast, i18n suites green; detector clean.
- 2026-10-29: page 8 application forms (guardian / student / teacher, apply-form) on the Stitch tokens (errors on the error token, focus ring secondary, gold notes on tertiary); no logic change; application validation, contrast, i18n suites green; detector clean.
