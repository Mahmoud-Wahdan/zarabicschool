# ZarabicSchool — Session 1: Reports (session + monthly), report languages, role dashboards, UI/UX

Repo: G:\programming\zarabicschool\webapp (existing app — do NOT rebuild).
Read first: docs/CONTEXT.md, INSTRUCTIONS.md, docs/specs/PROGRESS.md, phase-05 / phase-06 / phase-09 specs, database-schema.md. Inspect git status + current branch before editing. Never reset the DB, never discard my changes, never print secrets.

## 0. Rules
- NO automated tests this session: don't run npm test / jest / playwright, don't create test files. Don't run lint/typecheck/build repeatedly; run each ONCE at the very end. Tests are a separate step I will authorize later (section 11).
- Report everything as "implemented, not verified". Only I verify, in the browser.
- Anything not already confirmed in CONTEXT.md is written as PROPOSAL, never as a decision.
- Finance (Paymob webhook, plans, subscriptions, renewal, expiry) is Session 2 and is OUT of scope here. The only finance work in this session is the student-with-guardian wall (section 8).
- Phase 9 items are OUT of scope here (timezone-by-country 9.9, join window change 9.10, calendar, etc.). Do not build them early.
- Core principle (owner): THE SYSTEM RECORDS, THE ADMIN DECIDES. The system never compares reports against evaluations, never detects conflicts, never decides who is right.

## 1. UI/UX source (read BEFORE touching any screen)
Folder: G:\programming\zarabicschool\docs\stitch_zarabicschool_edtech_management_platform
Stitch export: 31 screen folders (screenshot + code.html each; zarabicschool_11 has a screenshot only) plus academic_precision/DESIGN.md (the design system "Academic Precision" — read it fully first).
Screen → role map (verify yourself, then write the inventory table):
- Landing + applications: zarabicschool_1, 2, 3, 5, 8 (landing); 4, 6, 7 (guardian / student / teacher application forms)
- Login + forced password change: zarabicschool_9, 10
- Admin: admin_operations_dashboard, applications_account_provisioning, people_accounts_directory_zarabicschool, schedule_live_sessions, recurring_session_provisioning_zarabicschool, absence_replacement_management_zarabicschool, report_approval_queue, billing_plan_configuration_suite, financials_subscriptions_invoicing_suite, monthly_payroll_closing_treasury_suite, teacher_payroll_hourly_rates_suite
- Supervisor: supervisor_operations_dashboard_zarabicschool
- Teacher: zarabicschool_11 (dashboard), 12 (schedule), 13 (End-class report form), 14 (earnings)
- Guardian: zarabicschool_15 (children), 16 (child report + plan)
- Student: zarabicschool_17 (session evaluation), 18 and 19 (dashboard)
Rules:
1. Screenshots + HTML are DESIGN REFERENCE ONLY. Extract tokens (colors, fonts, spacing, radius, shadows, card/table/badge/form styles) and implement them with the existing Tailwind/Next.js components and the shared app shell. Do not paste raw HTML (it uses Tailwind CDN), do not build parallel components. Map the tokens into the project's Tailwind theme once.
2. Every role has screens in the folder: follow them for that role's layout. Where a feature has no screen (e.g. the monthly report form, report-language selector), derive it from the closest screen and the same tokens. Do not invent a new style.
3. Brand: Navy #1B365D, Emerald #00897B, Gold #D4AF37; Cairo/Tajawal (ar), Montserrat/Inter (en); logical CSS properties for RTL.
4. Every screen: loading / empty / error / success states, RTL (ar) + LTR (en), mobile-first, polished. Goal: working AND good-looking.
Where the Stitch screens CONFLICT with confirmed decisions, the confirmed decisions win. Take only the visual language from the screens, never their business logic:
- Report approval screens show a "Dean" / "Dean Approved" / "Dean's Emergency Override" workflow. There is NO Dean role and NO override. Approval is by Admin or Supervisor only (submitted → approved/rejected). Keep the stepped-progress look, relabel to our states.
- DESIGN.md says the "Enter Classroom" button appears at T-10 minutes. Ignore any number in the screens: the join button uses the existing `lib/config/session-join.ts` constant and its localized hint. Do not hardcode minutes in UI text. (The owner will change the window to 30 minutes in Phase 9, item 9.10, not now.)
- Student screens (17, 18, 19) must not show prices, invoices, balances in money, or pay actions for a student WITH a guardian (section 8). Remaining-sessions count is allowed.
- Any money widget on a Supervisor screen must be removed (Supervisor never receives money fields).
- Any hardcoded demo text, fake names or numbers in the screens are placeholders only; render real data.

## 2. Remove fake messaging
- Delete the fake messaging provider and every direct import of it. Keep the MessagingProvider interface and OpenWAProvider, selected by config only.
- If OPENWA_* env vars are missing: no crash, no rollback. Write a redacted NotificationLog row (status failed/skipped; never passwords, never Zoom links) so Admin can retry when WhatsApp is connected.
- Keep the Admin one-time credentials panel as the fallback.
- Fix files that imported the fake (edit only).

## 3. Docs update FIRST (small, before feature work)
Bump CONTEXT.md to a 9th revision dated 2026-10-18 and keep section numbers stable (do not renumber). Mark everything below as owner decision 2026-10-18 unless it says PROPOSAL.
CONTEXT.md:
- §8 + §6 notification chain: the guardian (and student, per visibility) is notified when the teacher SUBMITS a report, not on approval. Approval concerns teacher pay only.
- §9: rewrite. Add: report language (section 6 below); the NEW monthly report as a separate report stream (resolves the old "may be the same stream, confirm in Phase 7" line); visibility rules (section 4); Admin session-detail page (section 5); evaluations stay Admin-only.
- §6/§7: rejection counter (PROPOSAL) instead of an automatic red mark; the red mark stays for LATE reports only.
- §12 + §21: a student WITH a guardian has no finance access at all; enforced server-side. Adult student without a guardian pays for himself.
- §2 + §21: add the Stitch folder as the UI/UX reference (screen→role map from section 1).
- §5: fake provider removed; missing OpenWA config = redacted failed NotificationLog row.
- §13: add the monthly report under Phase 5 (reports stream). §17: add status-table rows for all of the above. Also record the two Phase 9 additions (9.9 timezone by country, 9.10 join window 30 minutes) as owner decisions scheduled for Phase 9; the Phase 9 spec already contains them.
- DO NOT decide the USD provider: §20.3 says Dodo is chosen, §7 item 9 says Dodo vs Xpay is still being evaluated. Mark it as a conflict for the owner to resolve.
INSTRUCTIONS.md:
- §1 and §2: replace "submission only enters review" with: submission makes the report visible per the visibility rules; Admin/Supervisor approval drives settlement only.
- §4/§5: tests run only when the owner authorizes; until then agents report "implemented, not verified" and never claim done/secure.
- §7 first bullet: student payment is now gateway-based (webhook is the source of truth; manual proof is a fallback), not "manual".
- §10: no fake providers in production code; missing provider config produces a logged failed-send row, never a crash or rollback.
- New principle (e.g. §8b or §6): the system records, the Admin decides; no automatic conflict detection between reports and evaluations.
Also update PROGRESS.md and the relevant phase files.

## 4. Report visibility & flow
Two separate things, never mixed:
A) DELIVERY/VISIBILITY — automatic, independent of Admin:
   Teacher submits → report is immediately visible (dashboard + WhatsApp via MessagingProvider) to the guardian and the student per the rules below. Admin/Supervisor review has NO effect on visibility.
   If a report is rejected and corrected, it is the same row: viewers see the latest content; do NOT send a second WhatsApp for the same report (PROPOSAL).
B) PAY — SESSION report only:
   Admin/Supervisor approval of the session report triggers the existing atomic settlement (Phase 5/6, unchanged). Rejection returns the report to the teacher (existing flow).
Visibility rules (same for session and monthly):
   - Guardian, Admin, Supervisor: whole report.
   - Student WITH a guardian: session report → homework, notes, attachments only (existing). Monthly report → only "key learning objectives for next month" (PROPOSAL).
   - Adult student WITHOUT a guardian: whole report.
   - Teachers never see other teachers' reports. Evaluations stay Admin-only.

## 5. Admin as decision-maker
- Rejection counter (PROPOSAL): add `rejection_count` on reports (increment on each rejection). Admin/Supervisor see it on the report and in a per-teacher summary. NO automatic red mark and NO automatic penalty. Red mark stays for late reports only.
- Admin/Supervisor session-detail page: show side by side the teacher's report, the student's evaluation, the guardian's evaluation (if any), recorded attendance, and settlement history. READ-ONLY display. The system never compares, flags conflicts or decides.
- Corrections happen only through the EXISTING Admin-only reversal / ADMIN_ADJUSTMENT actions (reason mandatory, history never edited). Do not add new money logic. Supervisor sees no money fields on this page.

## 6. Report languages (client requirement)
Teachers write in the student's language: ar / en / fr / de / tr. Applies to session AND monthly reports.
- Add `report_language` enum (ar, en, fr, de, tr; default ar) on the student. Admin/Supervisor can edit it (student profile + application mapping). No "fusha" field.
- Separate from the site UI locale. Site UI stays ar/en. Adding fr/de/tr as UI languages is OUT of scope.
- The report form (labels, dropdown options, placeholders, validation messages) renders in the report language. Teacher can change a given report's language via a selector (default = student's report_language). Store `language` on each report row.
- No machine translation. Teacher writes the free text in that language. Show the report in the language it was written, with correct dir (rtl for ar, ltr otherwise), regardless of the viewer's UI locale; surrounding chrome stays in the UI locale.
- Class-remark options: Admin-managed list in AcademySettings, each with a label per language (ar/en/fr/de/tr). Seed: Excellent, Very Good, Good, Acceptable, Needs Improvement with translations.
- WhatsApp report notice uses the report language when a template exists, else the recipient's locale. No hardcoded strings.

## 7. Report forms
Session report ("End class", already implemented; reference screen zarabicschool_13): keep the fields (Class Remark required dropdown, Summary required, Homework required, Notes, Upload files JPEG/PNG/WebP/PDF by signature, 10 MB, private Storage), report icon only after the scheduled end. Add the language selector. Do not change approval/settlement.

Monthly report (NEW; PROPOSAL until I confirm; same permission model as the session report: only the assigned teacher, per student; NO money, NO attendance, NO ledger, NO approval gate):
1. Month (month picker; default previous month)
2. Achievement over the month (long text, required)
3. Learning progress: Excellent / Very Good / Good / Very Slow Progress
4. Active and focused in class: Always / Often / Sometimes / Rarely
5. Completes homework/tasks: Always / Most of the time / Sometimes / Rarely
6. Comes on time: Always / Often / Sometimes / Rarely
7. Sessions rescheduled in the month: None / 1 / 2 / More than 2 → computed automatically from real data (replacement sessions / approved outage requests), pre-filled, read-only
8. Areas needing additional support (text)
9. Key learning objectives for next month (text)
Rules: unique per (teacher, student, month); only for a month that has started; the teacher may edit for 7 days after submission, then it locks (PROPOSAL). Admin/Supervisor get an "all monthly reports" list filtered by month/teacher/student plus a "missing reports" list per teacher. The existing DB-polling worker sends the teacher a reminder on the 1st and 3rd of the month for missing reports (PROPOSAL). Additive migration only, Zod schemas, standard error shape {error:{code,message,fieldErrors?}}.

## 8. Dashboards — real data only, no mock
Audit every route for Teacher, Guardian, Student, Student-without-guardian, then fix/complete, applying the UI/UX from section 1:
- Every nav link resolves; every button is wired to a real API; loading/empty/error/success; RTL/LTR; mobile-first (teacher above all).
- Teacher: today's classes with the Zoom button, session report icon only after the end, monthly reports (list + form + missing ones), payroll (approved vs pending per currency; existing).
- Guardian: one card per child, session + monthly reports, attendance, remaining sessions, subscription status, invoices (existing).
- Student WITH a guardian: NO finance anywhere (no invoices, prices, pay buttons, proofs, no nav item). Show only the remaining-sessions count. Enforce SERVER-SIDE in the API/data layer. A direct URL/API call as this student must return 403/404.
- Student WITHOUT a guardian (adult): sees invoices/finance and can pay for himself.
- Supervisor never receives money fields (the data layer omits them).
- Remove dead links, placeholder buttons, hardcoded demo strings and any MISSING_MESSAGE keys (ar + en).

## 9. Order
1) UI/UX inventory → 2) docs update (section 3) → 3) fake-messaging removal → 4) report languages → 5) visibility/delivery change + rejection counter + Admin session-detail page → 6) monthly report → 7) dashboards (Teacher, Guardian, Student, Student-without-guardian) with the UI/UX applied. Don't stop between steps unless an owner decision truly blocks.

## 10. Migrations
Additive only, dev DB only. At the end list exactly which migrations are pending and the command to apply them. Never claim one is applied unless the DB shows it.

## 11. End of session — test PLAN only (do NOT write or run tests)
Write docs/specs/test-plan-session1.md covering THREE layers, not unit only:
- Unit: report-language resolution, monthly-report rules (unique, month started, edit window), visibility rules, student-with-guardian finance gate, rejection counter.
- Integration (real test DB): submit → visibility + notification rows; monthly unique constraint; finance gate returns 403/404; supervisor gets no money fields; settlement unchanged; admin session-detail returns no money to supervisor.
- E2E (Playwright): teacher submits session + monthly report in a non-Arabic language → guardian sees it in that language; student-with-guardian cannot reach finance; adult student can; admin sees report + evaluation side by side.
Run nothing until I say "Run the tests".

## 12. Final report
Short: done per section, files/migrations/APIs changed, pending migrations + commands, my PROPOSAL decisions to confirm (rejection counter, monthly-report student visibility, 7-day edit window, reminder days, no second WhatsApp after correction), the Dodo/Xpay conflict, implemented vs manually verified (honestly: nothing verified), a browser checklist, and the commands NOT executed.