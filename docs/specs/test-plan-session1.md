# ZarabicSchool — Phase 5 Session 1 Test Plan

> **STATUS:** TEST PLAN ONLY — **DO NOT RUN AUTOMATED TESTS** until explicitly authorized by the project owner per Session 1 §0 and §11 ("Run nothing until I say 'Run the tests'").
> **Rules:**
> 1. No dedicated test database — tests run against the development PostgreSQL DB with `demo_test_*` prefix and strict per-test cleanup (CONTEXT §17 / PROGRESS.md line 123).
> 2. Test runner is **Jest only** for unit and integration layers; Playwright for E2E.
> 3. All commands are executed from `webapp/`.
> 4. `notification_jobs` is the log table (no separate `NotificationLog` table exists).
> 5. Messaging environment variable names: `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`.

---

## 1. Scope & Objectives

This test plan defines the verification strategy for deliverables implemented in **Phase 5 Session 1**:
- **Report Language System:** Student default language mapping, teacher report-level language override (`ar`, `en`, `fr`, `de`, `tr`), and bidirectional UI rendering (RTL for Arabic, LTR for others) without translating app chrome.
- **Delivery & Visibility Decoupling:** Immediate visibility and notification upon report submission, completely independent of Admin/Supervisor approval (approval controls teacher pay/settlement only). Existing test suites are updated to remove expectations of guardian notices on approval.
- **Monthly Reports:** Dedicated monthly progress report stream with unique constraint `(teacherId, studentId, monthKey)`, month-started validation, 7-day server-side edit lock (`MONTHLY_REPORT_LOCKED`), automatic rescheduled sessions calculation (from replacement sessions OR approved outage requests — never both), and DB-polling reminders on day 1 and 3 of the month.
- **Student Finance Wall:** Strict server-side enforcement blocking students with a linked guardian from all financial routes, APIs, and UI elements (HTTP 403/redirect), covering checkout, proof upload, and GET invoice endpoints (`GET /api/invoices`, `GET /api/invoices/[id]`), while student dashboard payload exposes only the remaining-sessions count (no monetary fields). Adult students without guardians retain full payment access.
- **Supervisor Data Redaction & Evaluations Privacy:** Complete omission of monetary fields from Supervisor-facing queries and session detail views. Evaluations remain strictly **Admin-only** per CONTEXT §9 (omitted for Supervisor, Teacher, Student, Guardian).
- **Admin Unified Workspace:** Side-by-side read-only presentation of teacher report, student evaluation, guardian evaluation, attendance, and settlement history with zero automated conflict detection ("The System Records, The Admin Decides"). Strict HTTP 403/redirect for Teacher, Student, or Guardian accessing `/admin/sessions/[id]`.
- **Audit & Resilience:** Non-blocking notification failures (redacted failed `notification_jobs` rows on missing OpenWA configuration without transaction rollback) and rejection counters (`rejection_count` increment on rejection without automatic red marks).

---

## 2. Test Architecture & Layers

The verification suite is structured into three discrete layers:
1. **Unit Layer (Jest):** Pure functional logic, schema validation, permission predicates, language direction resolution, and data transformers (in-memory, no DB).
2. **Integration Layer (Jest):** Route handlers, DAL queries, and database constraints against the development PostgreSQL database using unique `demo_test_*` records and post-test cleanup.
3. **End-to-End Layer (Playwright):** Full browser journeys across localized RTL/LTR viewports, testing visual chrome separation, role access controls, and submission-to-view workflows.

```
+-----------------------------------------------------------------------+
|                       E2E Layer (Playwright)                         |
|  - Multilingual Form & Viewer (LTR/RTL Chrome Separation)            |
|  - Student Finance Wall (UI Absence + URL Redirects)                 |
|  - Admin Session Detail Side-by-Side Workspace                       |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|             Integration Layer (Jest — Dev DB with demo_test_* cleanup) |
|  - Submission -> Immediate Visibility & notification_jobs row         |
|  - Missing OpenWA Config (OPENWA_URL/API_KEY/SESSION_ID) -> FAILED job|
|  - Monthly Report Unique Constraint & Concurrent Submit Race (P2002)   |
|  - Monthly Report 7-Day Edit Lock & Day 1/3 Reminder Worker           |
|  - Server-Side Student Finance Wall (POST checkout/proofs, GET routes) |
|  - Supervisor Money Redaction + Evaluations Admin-Only Isolation      |
|  - Session Detail Page Role Guard (403 for Teacher/Student/Guardian)  |
|  - Approval Route Test Update (No Guardian Notice on Approval)        |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                          Unit Layer (Jest)                            |
|  - resolveReportLanguage & Direction Resolution (ar -> RTL, else LTR) |
|  - Monthly Report Rules (Month Started, 7-Day Edit Window)            |
|  - Rescheduled Count Formula (Replacement OR Outage, never both)      |
|  - Role & Guardian Visibility Filters (Session & Monthly)             |
|  - requireStudentFinanceAccess & studentFinanceBlocked Predicates     |
|  - Rejection Counter Increments without Penalty Flags                 |
+-----------------------------------------------------------------------+
```

---

## 3. Layer 1: Unit Test Specifications (Jest)

### 3.1 Report Language Resolution (`lib/reports/report-language.ts`)

| Test ID | Scenario | Input | Expected Output |
|---|---|---|---|
| `UNIT-LANG-01` | Default to student profile language | Student `reportLanguage: "fr"`, report draft `language: null` | `resolvedLanguage: "fr"`, `direction: "ltr"` |
| `UNIT-LANG-02` | Teacher explicit report-level override | Student `reportLanguage: "ar"`, teacher selects `"de"` | `resolvedLanguage: "de"`, `direction: "ltr"` |
| `UNIT-LANG-03` | Arabic language direction | `language: "ar"` | `direction: "rtl"` |
| `UNIT-LANG-04` | Non-Arabic language directions | `language: "en" \| "fr" \| "de" \| "tr"` | `direction: "ltr"` for all |
| `UNIT-LANG-05` | Fallback on unconfigured student | Student `reportLanguage: null` or unset | Falls back to Academy default `"ar"`, `direction: "rtl"` |
| `UNIT-LANG-06` | Invalid language code rejection | Zod parse `{ language: "es" }` | Schema validation error (`INVALID_ENUM_VALUE`) |

### 3.2 Monthly Report Business Rules (`lib/reports/monthly.ts`, `lib/validation/management.ts`)

| Test ID | Scenario | Input | Expected Output |
|---|---|---|---|
| `UNIT-MON-01` | Month not yet started | Month input = next calendar month (`YYYY-MM`) | Validation error: month must have already started (`MONTH_NOT_STARTED`) |
| `UNIT-MON-02` | Current and previous months valid | Month input = current month or past month | Validation succeeds |
| `UNIT-MON-03` | 7-day edit window — within window | `submittedAt = now - 6 days`, caller = assigned teacher | Edit allowed (`isMonthlyReportEditable` returns `true`) |
| `UNIT-MON-04` | 7-day edit window — expired | `submittedAt = now - 8 days`, caller = assigned teacher | Edit locked (`isMonthlyReportEditable` returns `false`) |
| `UNIT-MON-05` | Rescheduled sessions calculation | Replacement sessions linked to approved requests in month | Rescheduled count computed from replacement sessions OR approved requests — never both |
| `UNIT-MON-06` | Required fields validation | Payload missing `achievements` or progress metrics | Zod validation failure with standard `{ error: { code, message, fieldErrors } }` |

### 3.3 Visibility Rules (`lib/reports/visibility.ts`)

| Test ID | Scenario | Viewer Role | Expected Field Visibility |
|---|---|---|---|
| `UNIT-VIS-01` | Full report access | `ADMIN` / `SUPERVISOR` / `GUARDIAN` | 100% of session report & monthly report fields visible (no money fields in reports) |
| `UNIT-VIS-02` | Student WITH guardian (Session Report) | `STUDENT` with `guardianId != null` | Homework, notes, attachments ONLY. Remark, summary, ratings omitted. |
| `UNIT-VIS-03` | Student WITH guardian (Monthly Report) | `STUDENT` with `guardianId != null` | Key learning objectives for next month ONLY (`nextMonthObjectives`). Ratings and support areas omitted. |
| `UNIT-VIS-04` | Adult student WITHOUT guardian | `STUDENT` with `guardianId == null`, `isAdult: true` | Full session report and full monthly report visible. |
| `UNIT-VIS-05` | Cross-teacher isolation | `TEACHER_B` requesting `TEACHER_A` report | Access denied (returns `null` / generic 404) |
| `UNIT-VIS-06` | Evaluations isolation | `SUPERVISOR`, `TEACHER`, `STUDENT`, `GUARDIAN` | Evaluations are strictly Admin-only per CONTEXT §9; omitted for all other roles. |

### 3.4 Student Finance Gate (`lib/guards/student-finance.ts`, `lib/dal.ts`)

| Test ID | Scenario | User State | Expected Output |
|---|---|---|---|
| `UNIT-FIN-01` | Minor student with linked guardian | Student row has non-null `guardianId` | `studentFinanceBlocked` returns `true`; `requireStudentFinanceAccess` throws `403` (`FINANCE_ACCESS_FORBIDDEN`) |
| `UNIT-FIN-02` | Adult student without guardian | Student row has `guardianId == null`, `isAdult: true` | `studentFinanceBlocked` returns `false`; `requireStudentFinanceAccess` resolves cleanly |
| `UNIT-FIN-03` | Student dashboard payload data filter | Student has linked guardian | Payload returns only `remaining` sessions count; prices, invoices, and amounts omitted |

### 3.5 Rejection Counter (`lib/reports/session-report.ts`)

| Test ID | Scenario | Input | Expected Output |
|---|---|---|---|
| `UNIT-REJ-01` | Increment counter on rejection | Existing report `rejectionCount: 1`, Supervisor rejects | Updated `rejectionCount: 2` |
| `UNIT-REJ-02` | Penalty neutrality | Rejected report | No financial penalty ledger row created; late report red mark untouched |

---

## 4. Layer 2: Integration Test Specifications (Dev DB with demo_test_* cleanup)

### 4.1 Report Submission & Delivery Decoupling

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-REP-01` | `POST /api/sessions/[id]/students/[studentId]/report` | `TEACHER` | 1. Session report created in DB with status `SUBMITTED`.<br>2. Immediately queryable by linked `GUARDIAN` without Admin approval.<br>3. Notification queued in `notification_jobs` with kind `REPORT_SUBMITTED`.<br>4. Teacher's ledger row is **NOT** created (settlement unchanged until approval). |
| `INT-REP-02` | Report submission with missing WhatsApp config | `TEACHER` (mock env `OPENWA_URL`/`OPENWA_API_KEY`/`OPENWA_SESSION_ID` missing) | 1. Report saves successfully.<br>2. `notification_jobs` records row with status `FAILED` and error note.<br>3. Transaction does not roll back; HTTP 201 returned to teacher. |
| `INT-REP-03` | Report correction after rejection | `TEACHER` updating previously rejected report | 1. Same database row updated (`rejectionCount` preserved).<br>2. Latest content visible to viewers.<br>3. No second WhatsApp notification dispatched (deduped). |
| `INT-REP-04` | Approval route regression check | `ADMIN` / `SUPERVISOR` approving report | 1. Approves report and triggers atomic settlement.<br>2. **NO** guardian WhatsApp notification enqueued on approval (notice was already delivered on submit). |

### 4.2 Monthly Report Constraints & Worker Reminders

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-MON-01` | `POST /api/monthly-reports` | `TEACHER` | Creates report for valid `(teacherId, studentId, monthKey)`. Returns HTTP 201. |
| `INT-MON-02` | Concurrent duplicate monthly report submission | `TEACHER` (parallel requests) | One request succeeds (HTTP 201); concurrent second request catches Prisma unique constraint `P2002` and returns HTTP 409 `MONTHLY_REPORT_EXISTS`. |
| `INT-MON-03` | 7-day edit lock enforcement | `POST /api/monthly-reports` | Updating report with `submittedAt < now - 7 days` returns HTTP 409 `MONTHLY_REPORT_LOCKED`. |
| `INT-MON-04` | Admin & Supervisor monthly report queries | `ADMIN` / `SUPERVISOR` | `GET /api/monthly-reports?monthKey=YYYY-MM` returns reports matching academy, plus calculated list of missing monthly reports per teacher. |
| `INT-MON-05` | Monthly reminder worker (Day 1 and 3) | DB worker `processMonthlyReportReminders` | Generates `MONTHLY_REPORT_REMINDER` jobs for teachers with missing reports on day 1 and 3 of the month; suppressed on other days. |

### 4.3 Server-Side Student Finance Wall Enforcement

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-FIN-01` | `POST /api/invoices/[id]/checkout` | `STUDENT` (with linked guardian) | Rejects with HTTP 403 Forbidden. No payment attempt created. |
| `INT-FIN-02` | `POST /api/invoices/[id]/checkout` | `STUDENT` (adult, no guardian) | Permits execution. Creates `PaymentAttempt` and returns checkout URL. |
| `INT-FIN-03` | `POST /api/invoices/[id]/proofs` | `STUDENT` (with linked guardian) | Rejects with HTTP 403 Forbidden. Upload and DB insert aborted. |
| `INT-FIN-04` | `POST /api/invoices/[id]/proofs` | `STUDENT` (adult, no guardian) | Permits upload. HTTP 201 Created with valid `PaymentProof` record. |
| `INT-FIN-05` | `GET /api/invoices` | `STUDENT` (with linked guardian) | Rejects with HTTP 403 Forbidden (`FORBIDDEN`). |
| `INT-FIN-06` | `GET /api/invoices` | `STUDENT` (adult, no guardian) | Returns HTTP 200 with student's own invoices. |
| `INT-FIN-07` | `GET /api/invoices` | `SUPERVISOR` | Rejects with HTTP 403 Forbidden (Supervisor has no money access). |
| `INT-FIN-08` | `GET /api/invoices/[id]` | `STUDENT` (with linked guardian) | Rejects with HTTP 403 Forbidden. |
| `INT-FIN-09` | `GET /api/invoices/[id]` | `SUPERVISOR` | Rejects with HTTP 403 Forbidden. |

### 4.4 Session Detail Workspace & Supervisor Data Sanitization

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-SUP-01` | `GET /admin/sessions/[id]` | `TEACHER` / `STUDENT` / `GUARDIAN` | Rejects with HTTP 403 Forbidden / redirect (page restricted to Admin and Supervisor). |
| `INT-SUP-02` | `GET /admin/sessions/[id]` | `SUPERVISOR` | 1. Teacher report and attendance rendered side-by-side.<br>2. Settlement panel (payroll and deduction ledgers) completely omitted.<br>3. Evaluations panel completely omitted (Admin-only). |
| `INT-SUP-03` | `GET /admin/sessions/[id]` | `ADMIN` | Teacher report, student evaluation panel (reserved), attendance, and settlement history all rendered side-by-side with zero automatic conflict flags. |

---

## 5. Layer 3: End-to-End Test Specifications (Playwright)

### 5.1 Multilingual Report Flow & LTR/RTL Chrome Separation

- **Suite File:** `e2e/reports/multilingual-report.spec.ts`
- **Preconditions:** Seeded teacher, student with `reportLanguage: "fr"`, and linked guardian with UI locale `"ar"`.
- **Test Steps:**
  1. Teacher logs in and navigates to session report form (`/en/teacher/sessions/[id]/report`).
  2. Teacher verifies report language defaults to French (`fr`). Labels and placeholders render in French.
  3. Teacher fills out required fields in French and submits.
  4. Guardian logs in and navigates to child's report view (`/ar/guardian/reports`).
  5. **Assertions:**
     - The report body (content card) renders with `dir="ltr"` and French text.
     - The dashboard header, sidebar, and breadcrumbs render with `dir="rtl"` in Arabic.
     - No untranslated translation keys (`MISSING_MESSAGE`) appear on screen.

### 5.2 Student Finance Wall Verification

- **Suite File:** `e2e/finance/student-finance-wall.spec.ts`
- **Scenario A (Student with Guardian):**
  1. Login as Student with linked guardian.
  2. Navigate to student dashboard (`/en/student`).
  3. **Assert:** Invoices / billing navigation links are absent.
  4. Directly navigate URL to `/en/student/invoices`.
  5. **Assert:** Server-side redirect triggers immediately, redirecting back to `/en/student`.
  6. Dispatch synthetic `fetch('/api/invoices/[id]/checkout', { method: 'POST' })`.
  7. **Assert:** Response status is HTTP 403 Forbidden.
- **Scenario B (Adult Student without Guardian):**
  1. Login as Adult Student without guardian.
  2. Navigate to student dashboard (`/en/student`).
  3. **Assert:** Invoices navigation link is visible.
  4. Click Invoices navigation link -> lands on `/en/student/invoices`.
  5. **Assert:** Pending invoice card is rendered with Pay button / Invoice Payment Panel.

### 5.3 Admin Unified Decision-Making Workspace

- **Suite File:** `e2e/admin/session-decision-workspace.spec.ts`
- **Test Steps:**
  1. Admin logs in and opens `/en/admin/sessions/[id]`.
  2. **Assertions:**
     - Teacher report card is displayed.
     - Recorded attendance status is displayed.
     - Settlement history widget is displayed.
     - No automated "conflict", "discrepancy", or "override" warning banner is displayed by the system.
     - Admin action buttons (`Approve`, `Reject`) function cleanly with mandatory reason modal.

---

## 6. Execution Command Reference (WHEN AUTHORIZED)

> [!IMPORTANT]
> The commands below are **NOT TO BE RUN** until the project owner provides explicit clearance ("Run the tests").
> Run all commands from the `webapp/` directory.

```bash
# Unit & Integration Tests (Jest only — against dev DB with demo_test_* cleanup)
npm test -- webapp/__tests__/reports/report-language.test.ts
npm test -- webapp/__tests__/reports/monthly-reports.test.ts
npm test -- webapp/__tests__/guards/student-finance.test.ts
npm test -- webapp/__tests__/api/invoices-checkout.test.ts
npm test -- webapp/__tests__/api/invoices-endpoints.test.ts

# E2E Tests (Playwright)
npx playwright test e2e/reports/multilingual-report.spec.ts
npx playwright test e2e/finance/student-finance-wall.spec.ts
npx playwright test e2e/admin/session-decision-workspace.spec.ts
```
