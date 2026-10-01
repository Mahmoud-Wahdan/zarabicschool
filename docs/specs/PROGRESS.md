# Zarabicschool — Project Progress

> **Protocol:** Always read this file first in any new session. After completing any meaningful chunk of work, update the status table and the current phase's spec file. Never regenerate this file from scratch — extend it.
>
> Last updated: 2026-09-30

## Phase Status

| # | Phase | Status | Last Updated | Note |
|---|-------|--------|--------------|------|
| 1 | Foundation | In Progress | 2026-09-30 | Documentation aligned; implementation target is `webapp/` |
| 2 | Educational Management | Not Started | 2026-09-28 | — |
| 3 | Schedules & Sessions | Not Started | 2026-09-28 | — |
| 4 | Live Learning (Zoom links) | Not Started | 2026-09-30 | Reduced to manual links and authorized redirect |
| 5 | Session Reports & Attendance | Not Started | 2026-09-30 | Reports are attendance evidence and pay trigger |
| 6 | Financial Management | Not Started | 2026-09-28 | — |
| 7 | Admin & Reports | Not Started | 2026-09-28 | — |
| 8 | Testing & Launch | Not Started | 2026-09-28 | — |

## Current Active Task

Current task: documentation migration from the 2026-09-29 context revision. Implementation target is `webapp/`; root `docs/` contains project documentation.

## Action Items

- [ ] Rotate any exposed secrets before real data is stored; no Zoom API secrets are required.
- [ ] Confirm `NEXTAUTH_SECRET` is configured; `JWT_SECRET` is not used because authentication is Auth.js only.
- [ ] Decide the timed-notification scheduler: BullMQ + Redis versus database polling.
- [x] Confirm Supabase as the final Postgres host: Confirmed.
- [x] Ensure `.env` is in `.gitignore` and create `.env.example` with variable names only.
- [x] Align context/spec documentation with external Zoom links, no video recordings, and teacher mobile dashboard requirements.
- [x] Update payroll rule: teacher report triggers scheduled-duration hourly credit and student deduction in one transaction.
- [x] Remove Zoom event, attendance threshold, overlap-billing, recording, and reconciliation requirements from the documentation.
- [ ] Confirm login identifier, application fields, TeacherRates design, report values, attachment cap, rounding, and zero-session mechanism.
- [x] Confirm unified immutable Reports: Teacher + Student + Session FKs; `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; Admin approval gates settlement; no revision/version table.
- [x] Confirm SessionStudents is the persisted attendance source; evaluations are separate and missing evaluation is not absence.
- [ ] Decide whether student evaluation is mandatory after every completed session.

## 2026-09-30 Documentation Update

- Prompt A: corrected the schema, business model, and progress index for manual Zoom links, report-based attendance, prepaid sessions, hourly pay, append-only ledgers, and raw SQL constraints.
- Prompt B: phase-spec upgrade is next and must consume the corrected schema without editing it.

## 2026-09-30 Report Architecture Update

- Reports are one immutable historical entity linked to Session, Teacher, and Student. Rejected reports return to the teacher for correction; approved reports settle atomically and become archived.
- Settlement requires Admin approval, is idempotent, and rolls back both ledger effects on failure. Completed sessions may have missing reports.

## Post-delivery SaaS roadmap

Documented only for now: multi-academy onboarding and billing, tenant administration, RLS and tenant switching, tenant-scoped uniqueness, provider configuration, and an optional future Zoom verification layer. No current phase creates tasks for this roadmap.
