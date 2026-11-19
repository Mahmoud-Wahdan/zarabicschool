# Frontend review · 19 November 2026

## Audit and implementation order

| Priority | Surface | Finding and planned change |
| --- | --- | --- |
| High | Student calendar | The dashboard query scopes sessions to a student but selects the entire roster. Filter the nested projection too. |
| High | Guardian home | A preview limited to three rows masquerades as a total. Cancelled lessons can appear. Report availability is static. Scope a child selector, exact upcoming count and recent feedback to the guardian relationship. |
| High | All five dashboards | Action queues, homework and financial details exist, but comparison periods are hard to find. Add a compact, server-rendered activity comparison with explicit dates, definitions and empty values. |
| Medium | Admin and Supervisor | Existing analytics already covers workload, attendance and enrollment. Surface active-account counts and a drill-down. Keep financial queries confined to Admin. |
| Medium | Authentication | Animated service status has no health source. Brand and portal headings precede sign-in. Give the task the main heading, simplify decoration and preserve recovery instructions. |
| Medium | Reports and tables | Existing analytics offers data tables alongside SVGs. Inspect overflow, keyboard reach and missing-data handling. Distinguish completed lessons from attendance and mastery. |
| Medium | Navigation and profile | Shared shell supplies active-page semantics, drawer and skip link. Check focus, touch controls and long Arabic labels in the browser. Account timezone controls determine analytics boundaries. |
| Medium | Loading and errors | Localized route boundaries exist. Keep page-specific actions independent of slower analytics using a localized streaming fallback. |
| Lower | Landing and application | Landing has mobile menu, FAQ, theme and locale controls with regression coverage. Recheck navigation and overflow before changing its recent design. Application and settings forms share input tokens. |

Role checks, calendar timezone rules, submit-time report visibility and invoice/payroll services are the implementation boundaries. Retention, mastery and risk scores require agreed definitions. A completed session describes report submission for the roster. It does not demonstrate an individual student's attendance or mastery.

## Tools

The installed Impeccable audit and craft playbooks informed the hierarchy, state and contrast review. The upstream project supports Codex and documents the installer and project scope at [Impeccable](https://github.com/pbakaus/impeccable). [Stark](https://github.com/f0d010c/stark) describes product flows and interface review. Browser checks use the project's Playwright and axe packages. The installed Next.js guides cover data fetching and Server Component boundaries. No additional design engine, dependency or install script is required.

## Implemented changes

| Role | Daily decision | Evidence and drill-down |
| --- | --- | --- |
| Admin | Which academic or financial queue needs attention? | Existing daily sessions, approvals, invoices and collections lead the page. Monthly comparisons add attendance, completion, outstanding teacher reports and submission rate. Current active user counts, returning attendees and credited session pay supplement the workload, enrollment and revenue detail pages. |
| Supervisor | Which reports need follow-up? | The academic comparison, teacher flags and operational queues lead to reports and academy analytics. Only Admin and Teacher execute the new payroll query. |
| Teacher | Which lesson or report comes next? | The next lesson and outstanding reports precede month comparisons. The summary includes scheduled lesson volume, completed teaching hours, attendance, distinct students with an active assignment, and the teacher's own credited session pay. |
| Student | What did I work on and what comes next? | The next lesson and recent homework lead. Personal session history is summarized by month and completed lessons by subject. The latest eligible monthly review uses the existing report visibility service. |
| Guardian | How is each linked child doing? | A child selector scopes the schedule, exact upcoming count, lesson activity and reports. The first three upcoming scheduled lessons are listed. Feedback comes from the latest submitted session report. Existing subscription and invoice workflows remain available. |

The shared page header uses a smaller mobile title and a single divider. The comparison uses one semantic table with row and column headers, the existing brand variables, logical spacing, and a localized loading status. The month chooser retains the current calendar and child parameters. Family report content keeps its recorded language. The login form identifies invalid fields, focuses the first error, and exposes the password toggle state. Application audio requests now cancel on navigation and expose a translated retry action.

The landing-page browser tests found that the active page had lost its keyboard menu and FAQ even though both remained in the test suite. The mobile disclosure now returns focus on Escape. The landing page renders the existing five-question accordion in the former placeholder-testimonial section.

## Metric definitions

The selected month and the preceding month use half-open intervals between local midnights in the viewer's IANA timezone. The current month includes future bookings. The selector offers the last twelve months. Current account and assignment counts are snapshots.

| Display | Source and aggregation |
| --- | --- |
| Lessons, completed, missed | Session status grouped by scheduled start. The lesson total excludes cancelled sessions. Each group lesson counts once. |
| Completion rate | Completed sessions divided by all non-cancelled sessions in the month. Future bookings remain in the current-month denominator. |
| Reported attendance | Submitted completion reports marked attended divided by all completion reports for the relevant roster, including absent outcomes. The label describes teacher-reported attendance. |
| Missing reports and submission rate | Each roster student in an ended scheduled or completed session expects one report. Missing equals expected minus submitted. Submission rate divides submitted by expected. Counts share a repeatable-read snapshot. |
| Completed teaching hours | Sum of the scheduled duration in minutes on completed sessions divided by 60. This measures scheduled teaching time on completed lessons. |
| Active people | Active user accounts grouped by role within the academy. Assigned students count distinct students with an active assignment to the signed-in teacher. |
| Returning attendees | Distinct students with an attended report in the previous month who also have an attended report in the selected month. This measures repeat participation. The current month's cohort can grow. |
| Credited session pay | Existing session-credit ledger entries by posting date, summed separately per currency. Adjustments and disbursements remain on the payroll page. This summary reads the ledger. |
| Learning review | Most recent submitted monthly report through the selected month. The existing viewer service controls achievement and next-month objectives. The subject breakdown counts completed sessions. |

Counts can be zero. An empty rate denominator renders a localized unavailable value. The app has no verified general operating-expense ledger or agreed mastery scale. Neither is inferred from invoice totals, attendance, or teacher pay. Platform-wide risk rankings and cross-child comparisons are outside the confirmed business rules.

## Performance and screenshots

English sign-in on local Chromium at 390 × 900. Four fresh browser contexts per revision, one warm-up excluded from timing. The development server was warm, with no network or CPU throttling. JavaScript bytes sum Resource Timing transfer sizes for script URLs before interacting. These are local observations, not field Core Web Vitals.

| Measurement | Before | After |
| --- | ---: | ---: |
| Initial JavaScript transferred | 1,096,433 bytes | 908,560 bytes |
| Font preloads | 7 | 4 |
| Elements inside main | 61 | 47 |
| Main content height | 1,044 px | 900 px |
| LCP, three runs | 300, 268, 272 ms | 304, 304, 308 ms |
| Median LCP | 272 ms | 304 ms |
| CLS, three runs | 0, 0, 0 | 0, 0, 0 |

Sign-in validation and the authentication client load on submit. Heading fonts load on demand. Initial transfer fell, while median LCP was 32 ms slower in this sample. INP, production bundle transfer, and authenticated dashboard response-time distributions remain unmeasured. On the default staff calendar, today's summary reuses the visible session result. Browsing another period fetches only today's timestamps and status for the summary.

| Public sign-in | Before | After |
| --- | --- | --- |
| English mobile | [390 px](landing-review/login-en-390-before.png) | [390 px](landing-review/login-en-390-after.png) |
| Arabic tablet | [768 px](landing-review/login-ar-768-before.png) | [768 px](landing-review/login-ar-768-after.png) |
| English desktop | [1440 px](landing-review/login-en-1440-before.png) | [1440 px](landing-review/login-en-1440-after.png) |

## Verification and QA environment

- **10 public Playwright tests passed.** Arabic and English coverage includes header controls, Escape and focus return, FAQ disclosure, sign-in validation, password visibility, responsive overflow checks and anonymous redirects for all five role homes. Axe reported zero violations in the tested sign-in main landmark. The public suite disables the worker and points both database URLs at a closed loopback port.
- **4 calculation tests passed.** Coverage includes zero denominators, distinct session and report units, cancelled lessons, recorded absence, report submission and Cairo's October timezone transition. These tests exercise the production summarizer using test-only inputs.
- **Earlier demo smoke checks.** Five existing demo accounts signed in through the ordinary credential flow. Each initial role panel rendered without overflow at its sampled viewport and passed its scoped axe scan. The configured database is remote. These observations predate the final changes and do not establish isolated acceptance.
- **Isolated dashboard verification is pending.** This machine has no running local PostgreSQL instance or Docker engine. The application normally uses Prisma with hosted PostgreSQL. No local installation is necessary to run the application. No isolated fixture database, seed, or authenticated 30-image matrix was created. The planned matrix covers five roles, two languages and three widths. No captures of remote account data are part of the deliverable.

### Reproduce the checks

From the webapp directory, the public suite and calculation tests use the existing toolchain.

```powershell
$env:QA_PUBLIC_ONLY = '1'
node node_modules/@playwright/test/cli.js test -c playwright.dashboard.config.ts
node --import tsx --test e2e/activity-calculations.unit.ts
npm.cmd run typecheck
npm.cmd run lint
```

For a future authenticated run, the fixture preparer accepts an existing **empty loopback PostgreSQL database** named `zarabic_qa*` through `QA_DATABASE_URL`. It validates the target before using the existing migrations and demo seed. The generated credentials and browser states are under the ignored `e2e/.run/` directory. The suite signs in using Auth.js and changes the seeded administrator's temporary password through the application. It writes screenshots into `docs/dashboard-review/`. The original whole-site Playwright configuration references integration helpers absent from this checkout.

```powershell
node e2e/prepare-dashboard-qa.mjs
Remove-Item Env:QA_PUBLIC_ONLY -ErrorAction SilentlyContinue
node node_modules/@playwright/test/cli.js test -c playwright.dashboard.config.ts
```

### Source map

The five role home pages compose the dashboard sections. `lib/dashboard/activity.ts` scopes queries and `summarize-activity.ts` calculates the displayed rates. The calendar range and today services implement the projection and reuse changes. `activity-summary.tsx`, `learning-review.tsx`, `page-header.tsx`, the existing global CSS and both locale catalogs contain the shared presentation. Public changes live in the landing page, menu, login route and locale layout. QA lives in `e2e/` and `playwright.dashboard.config.ts`. Business rules, schema and settlement remain in their original services.
