# ZarabicSchool — Phase 5 Session 1 Test Plan

> **STATUS:** TEST PLAN ONLY — **DO NOT RUN AUTOMATED TESTS** until explicitly authorized by the project owner per Session 1 §0 and §11 ("Run nothing until I say 'Run the tests'").

---

## 1. Scope & Objectives

This test plan defines the verification strategy for deliverables implemented in **Phase 5 Session 1**:
- **Report Language System:** Student default language mapping, teacher report-level language override (`ar`, `en`, `fr`, `de`, `tr`), and bidirectional UI rendering (RTL for Arabic, LTR for others) without translating app chrome.
- **Delivery & Visibility Decoupling:** Immediate visibility and notification upon report submission, completely independent of Admin/Supervisor approval (approval controls settlement only).
- **Monthly Reports:** New monthly progress report stream with strict unique constraints, month-started validation, and 7-day edit locking (`PROPOSAL`).
- **Student Finance Wall:** Strict server-side enforcement blocking students with a linked guardian from all financial routes, APIs, and UI elements (403/404), while allowing adult students without guardians full payment access.
- **Supervisor Data Redaction:** Complete omission of monetary and ledger figures from Supervisor-facing queries and session detail views.
- **Admin Unified Workspace:** Side-by-side read-only presentation of teacher reports, student/guardian evaluations, and attendance with zero automated conflict detection ("The System Records, The Admin Decides").
- **Audit & Resilience:** Non-blocking notification failures (redacted `NotificationLog` rows on missing OpenWA configuration) and rejection counters.

---

## 2. Test Architecture & Layers

The verification suite is structured into three discrete layers:
1. **Unit Layer:** Pure functional logic, schema validation, permission predicates, and data transformers (zero DB or mocked in-memory).
2. **Integration Layer:** Route handlers, DAL queries, and database constraints against a dedicated test PostgreSQL/Supabase database.
3. **End-to-End Layer (Playwright):** Full browser journeys across localized RTL/LTR viewports, testing visual chrome separation, role access controls, and submission-to-view workflows.

```
+-----------------------------------------------------------------------+
|                       E2E Layer (Playwright)                         |
|  - Multilingual Form & Viewer (LTR/RTL Chrome Separation)            |
|  - Student Finance Wall (UI Absence + URL Redirects)                 |
|  - Admin Session Detail Side-by-Side Verification                     |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                    Integration Layer (Test Postgres DB)               |
|  - Submission -> Visibility & Notification Log Insertion              |
|  - OpenWA Missing Config -> Redacted Failure Logging (No Rollback)    |
|  - Monthly Report Unique Constraint (teacherId, studentId, month)     |
|  - Server-Side API Finance Guard (403/404 on Direct Invocations)      |
|  - Supervisor DAL Money Redaction & Atomic Settlement Invariance      |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                          Unit Layer (Fast / Pure)                     |
|  - resolveReportLanguage & Direction Resolution (ar -> RTL, else LTR) |
|  - Monthly Report Rules (Month Started, 7-Day Edit Window)            |
|  - Role & Guardian Visibility Filters (Session & Monthly)             |
|  - requireStudentFinanceAccess & studentFinanceBlocked Predicates     |
|  - Rejection Counter Increments without Penalty Flags                 |
+-----------------------------------------------------------------------+
```

---

## 3. Layer 1: Unit Test Specifications

### 3.1 Report Language Resolution (`lib/reports/report-language.ts`)

| Test ID | Scenario | Input | Expected Output |
|---|---|---|---|
| `UNIT-LANG-01` | Default to student profile language | Student `reportLanguage: "fr"`, report draft `language: null` | `resolvedLanguage: "fr"`, `direction: "ltr"` |
| `UNIT-LANG-02` | Teacher explicit report-level override | Student `reportLanguage: "ar"`, teacher selects `"de"` | `resolvedLanguage: "de"`, `direction: "ltr"` |
| `UNIT-LANG-03` | Arabic language direction | `language: "ar"` | `direction: "rtl"` |
| `UNIT-LANG-04` | Non-Arabic language directions | `language: "en" | "fr" | "de" | "tr"` | `direction: "ltr"` for all |
| `UNIT-LANG-05` | Fallback on unconfigured student | Student `reportLanguage: null` or unset | Falls back to Academy default `"ar"`, `direction: "rtl"` |
| `UNIT-LANG-06` | Invalid language code rejection | Zod parse `{ language: "es" }` | Schema validation error (`INVALID_ENUM_VALUE`) |

### 3.2 Monthly Report Business Rules (`lib/reports/monthly.ts`, `lib/validation/management.ts`)

| Test ID | Scenario | Input | Expected Output |
|---|---|---|---|
| `UNIT-MONTH-01` | Month not yet started | Month input = next calendar month (`YYYY-MM`) | Zod / helper returns validation error: month must have already started |
| `UNIT-MONTH-02` | Current and previous months valid | Month input = current month or past month | Validation succeeds |
| `UNIT-MONTH-03` | 7-day edit window — within window | `submittedAt = now - 6 days`, caller = assigned teacher | Edit allowed (`isEditable: true`) (`PROPOSAL`) |
| `UNIT-MONTH-04` | 7-day edit window — expired | `submittedAt = now - 8 days`, caller = assigned teacher | Edit rejected with `REPORT_LOCKED` (`PROPOSAL`) |
| `UNIT-MONTH-05` | Rescheduled sessions calculation | 2 approved outages + 1 replacement session in month | Rescheduled count returns `3` (pre-filled, read-only) |
| `UNIT-MONTH-06` | Required fields validation | Payload missing `achievements` or progress metrics | Zod validation failure with standard `{ error: { code, message, fieldErrors } }` |

### 3.3 Visibility Rules (`lib/reports/visibility.ts`)

| Test ID | Scenario | Viewer Role | Expected Field Visibility |
|---|---|---|---|
| `UNIT-VIS-01` | Full report access | `ADMIN` / `SUPERVISOR` / `GUARDIAN` | 100% of session report & monthly report fields visible |
| `UNIT-VIS-02` | Student WITH guardian (Session Report) | `STUDENT` with `guardianId != null` | Homework, notes, attachments ONLY. Remark, summary, internal ratings omitted. |
| `UNIT-VIS-03` | Student WITH guardian (Monthly Report) | `STUDENT` with `guardianId != null` | Key learning objectives for next month ONLY (`PROPOSAL`). Progress ratings & support areas omitted. |
| `UNIT-VIS-04` | Adult student WITHOUT guardian | `STUDENT` with `guardianId == null` | Full session report and full monthly report visible. |
| `UNIT-VIS-05` | Cross-teacher isolation | `TEACHER_B` requesting `TEACHER_A` report | Access denied (`404` or `403` / returns `null`) |
| `UNIT-VIS-06` | Evaluations isolation | `TEACHER` or `GUARDIAN` requesting student evaluation | Evaluative answers omitted; evaluations are Admin/Supervisor-only |

### 3.4 Student Finance Gate (`lib/guards/student-finance.ts`, `lib/dal.ts`)

| Test ID | Scenario | User State | Expected Output |
|---|---|---|---|
| `UNIT-FIN-01` | Minor student with linked guardian | Student row has non-null `guardianId` | `studentFinanceBlocked` returns `true`; `requireStudentFinanceAccess` throws `403` (`FINANCE_ACCESS_FORBIDDEN`) |
| `UNIT-FIN-02` | Adult student without guardian | Student row has `guardianId == null`, `isAdult: true` | `studentFinanceBlocked` returns `false`; `requireStudentFinanceAccess` resolves without error |
| `UNIT-FIN-03` | Non-student role bypass | User role = `GUARDIAN` or `ADMIN` | Finance access permitted |

### 3.5 Rejection Counter (`lib/reports/session-report.ts`)

| Test ID | Scenario | Input | Expected Output |
|---|---|---|---|
| `UNIT-REJ-01` | Increment counter on rejection | Existing report `rejectionCount: 1`, Supervisor rejects | Updated `rejectionCount: 2` (`PROPOSAL`) |
| `UNIT-REJ-02` | Penalty neutrality | Rejected report | No financial penalty ledger row created; late report flags untouched |

---

## 4. Layer 2: Integration Test Specifications (Real Test DB)

> Note: All integration tests run against a staging/test PostgreSQL instance using transactional isolation or fixture rollback.

### 4.1 Report Submission & Delivery Decoupling

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-REP-01` | `POST /api/sessions/[id]/students/[studentId]/report` | `TEACHER` | 1. Session report created in DB with status `SUBMITTED`.<br>2. Immediately queryable by linked `GUARDIAN` without Admin approval.<br>3. Notification queued in `NotificationLog` with sanitized payload.<br>4. Teacher's ledger row is **NOT** created (settlement unchanged until approval). |
| `INT-REP-02` | Report submission with missing WhatsApp config | `TEACHER` (mock env `OPENWA_API_URL` missing) | 1. Report saves successfully.<br>2. `NotificationLog` records row with status `FAILED`/`SKIPPED`.<br>3. Transaction does not roll back; HTTP 201 returned to teacher. |
| `INT-REP-03` | Report correction after rejection | `TEACHER` updating previously rejected report | 1. Same database row updated (`rejectionCount` preserved).<br>2. Latest content visible to viewers.<br>3. No second WhatsApp notification dispatched (`PROPOSAL`). |

### 4.2 Monthly Report Constraints

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-MON-01` | `POST /api/monthly-reports` | `TEACHER` | Creates report for valid `(teacherId, studentId, month)`. Returns HTTP 201. |
| `INT-MON-02` | Duplicate monthly report submission | `TEACHER` | Attempting to create duplicate report for same `(teacherId, studentId, month)` triggers unique constraint; returns HTTP 409 Conflict. |
| `INT-MON-03` | Admin & Supervisor monthly report queries | `ADMIN` / `SUPERVISOR` | `GET /api/monthly-reports?month=YYYY-MM` returns reports matching academy, plus calculated list of missing monthly reports per teacher. |

### 4.3 Server-Side Student Finance Wall Enforcement

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-FIN-01` | `POST /api/invoices/[id]/checkout` | `STUDENT` (with linked guardian) | Route invokes `requireStudentFinanceAccess(user.id)`.<br>**Result:** HTTP 403 Forbidden (`FORBIDDEN`). No payment attempt created. |
| `INT-FIN-02` | `POST /api/invoices/[id]/checkout` | `STUDENT` (adult, no guardian) | Route permits execution.<br>**Result:** Creates `PaymentAttempt` and returns checkout URL. |
| `INT-FIN-03` | `POST /api/invoices/[id]/proofs` | `STUDENT` (with linked guardian) | Route invokes `requireStudentFinanceAccess(user.id)`.<br>**Result:** HTTP 403 Forbidden. Upload and DB insert aborted. |
| `INT-FIN-04` | `POST /api/invoices/[id]/proofs` | `STUDENT` (adult, no guardian) | Route permits upload.<br>**Result:** HTTP 201 Created with valid `PaymentProof` record. |

### 4.4 Supervisor Data Sanitization & Session Detail

| Test ID | Method & Route | Actor | Verification Criteria |
|---|---|---|---|
| `INT-SUP-01` | `GET /api/sessions/[id]` or Server Component DAL | `SUPERVISOR` | All monetary amounts (`amountMinor`, `hourlyRate`, `earnings`, ledger adjustments) are omitted/null in DAL response. |
| `INT-SUP-02` | Session Detail Page Data Assembly | `ADMIN` vs `SUPERVISOR` | Admin sees teacher report, student evaluation, guardian evaluation, and settlement history side-by-side. Supervisor sees all evaluations and attendance, but settlement and currency widgets are completely omitted. |
| `INT-SUP-03` | Approval & Settlement Integrity | `ADMIN` / `SUPERVISOR` approving session report | Status transitions `SUBMITTED` -> `APPROVED`. Atomic settlement executes via Phase 5/6 transaction. Monthly report has no approval endpoint or ledger trigger. |

---

## 5. Layer 3: End-to-End Test Specifications (Playwright)

### 5.1 Multilingual Report Flow & LTR/RTL Chrome Separation

- **Suite File:** `e2e/reports/multilingual-report.spec.ts`
- **Preconditions:** Seeded teacher, student with `reportLanguage: "fr"`, and linked guardian with UI locale `"ar"`.
- **Test Steps:**
  1. Teacher logs in and navigates to session report form (`/en/teacher/sessions/[id]/report`).
  2. Teacher verifies report language defaults to French (`fr`). Labels and placeholders render in French.
  3. Teacher fills out required fields in French and submits.
  4. Guardian logs in and navigates to child's report view (`/ar/guardian/children/[studentId]/reports`).
  5. **Assertions:**
     - The report body (content card) renders with `dir="ltr"` and French text.
     - The dashboard header, sidebar, and breadcrumbs render with `dir="rtl"` in Arabic.
     - No raw untranslated translation keys (`MISSING_MESSAGE`) appear on screen.

### 5.2 Student Finance Wall Verification

- **Suite File:** `e2e/finance/student-finance-wall.spec.ts`
- **Preconditions:**
  - Student A: Minor student with linked guardian.
  - Student B: Adult student without guardian.
- **Scenario A (Student with Guardian):**
  1. Login as Student A.
  2. Navigate to student dashboard (`/en/student`).
  3. **Assert:** Invoices / billing navigation links are absent.
  4. Directly navigate URL to `/en/student/invoices`.
  5. **Assert:** Server-side redirect triggers immediately, redirecting back to `/en/student`.
  6. Dispatch synthetic `fetch('/api/invoices/[id]/checkout', { method: 'POST' })`.
  7. **Assert:** Response status is HTTP 403 Forbidden.
- **Scenario B (Adult Student without Guardian):**
  1. Login as Student B.
  2. Navigate to student dashboard (`/en/student`).
  3. **Assert:** Invoices navigation link is visible.
  4. Click Invoices navigation link -> lands on `/en/student/invoices`.
  5. **Assert:** Pending invoice card is rendered with Pay button / Invoice Payment Panel.

### 5.3 Admin Unified Decision-Making Workspace

- **Suite File:** `e2e/admin/session-decision-workspace.spec.ts`
- **Preconditions:** Completed session with submitted teacher report, submitted student evaluation, and recorded attendance.
- **Test Steps:**
  1. Admin logs in and opens `/en/admin/sessions/[id]`.
  2. **Assertions:**
     - Teacher report card is displayed.
     - Student evaluation card is displayed side-by-side with answers.
     - Guardian evaluation card is displayed (or empty state if not submitted).
     - Recorded attendance status is displayed.
     - Settlement history widget is displayed.
     - No automated "conflict", "discrepancy", or "override" warning banner is displayed by the system.
     - Admin action buttons (`Approve`, `Reject`, `Reversal`) function cleanly with mandatory reason modal.

---

## 6. Execution Command Reference (WHEN AUTHORIZED)

> [!IMPORTANT]
> The commands below are **NOT TO BE RUN** until the project owner provides explicit clearance ("Run the tests").

```bash
# Unit & Integration Tests (Vitest / Jest)
npm test -- webapp/__tests__/reports/report-language.test.ts
npm test -- webapp/__tests__/reports/monthly-reports.test.ts
npm test -- webapp/__tests__/guards/student-finance.test.ts
npm test -- webapp/__tests__/api/invoices-checkout.test.ts

# E2E Tests (Playwright)
npx playwright test e2e/reports/multilingual-report.spec.ts
npx playwright test e2e/finance/student-finance-wall.spec.ts
npx playwright test e2e/admin/session-decision-workspace.spec.ts
```
