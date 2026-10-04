# Zarabicschool — Project Progress

> **Protocol:** Always read this file first in any new session. After completing any meaningful chunk of work, update the status table and the current phase's spec file. Never regenerate this file from scratch — extend it.
>
> Last updated: 2026-10-03

## Phase Status

| # | Phase | Status | Last Updated | Note |
|---|-------|--------|--------------|------|
| 1 | Foundation | In Progress | 2026-10-03 | Slices A3 (next-intl) and B+ (full landing page, DB subjects) done and verified; next: slice A4 (tests) |
| 2 | Educational Management | In Progress | 2026-10-01 | Started early (applications/subjects endpoints); form fields CONFIRMED by owner, forms not built yet |
| 3 | Schedules & Sessions | Not Started | 2026-09-28 | — |
| 4 | Live Learning (Zoom links) | Not Started | 2026-09-30 | Reduced to manual links and authorized redirect |
| 5 | Session Reports & Attendance | Not Started | 2026-09-30 | Reports are attendance evidence and pay trigger |
| 6 | Financial Management | Not Started | 2026-09-28 | — |
| 7 | Admin & Reports | Not Started | 2026-09-28 | — |
| 8 | Testing & Launch | Not Started | 2026-09-28 | — |

## Current Active Task

Phase 1 on branch `feature/phase-1-foundation`. Slice A3 (next-intl) done and verified 2026-10-03: `[locale]` routing, locale-aware login/change-password/dashboards, proxy role checks + i18n, LocaleSwitcher, 404. Slice B+ (full landing page) done and verified: sticky header with hamburger + anchors, hero with arch visual, features strip, subjects from DB (bilingual, `demo-` seed rows available via `db:seed:demo`), why-us, how-to-start, apply role cards → `/apply?type=`, FAQ accordion, closing CTA, footer; landing copy lives in the new messages key tree (brand/common/nav/hero/features/subjects/why/steps/apply/faq/closing/footer/comingSoon) with login/changePassword/dashboard/notFound merged back; `lucide-react` added; Subject model expanded to bilingual fields (`slug`, `nameAr/nameEn`, `descriptionAr/descriptionEn`, `icon`, `sortOrder`) with migration `20261003120000_subject_bilingual`. Next: slice A4 (rate-limit unit tests + DB integration tests, jest config). Seed is NOT run until the owner confirms secret rotation. Implementation target is `webapp/`; root `docs/` contains project documentation.

## Action Items

- [ ] Rotate any exposed secrets before real data is stored; no Zoom API secrets are required.
- [ ] Confirm `NEXTAUTH_SECRET` is configured; `JWT_SECRET` is not used because authentication is Auth.js only.
- [ ] Decide the timed-notification scheduler: BullMQ + Redis versus database polling.
- [x] Confirm Supabase as the final Postgres host: Confirmed.
- [x] Ensure `.env` is in `.gitignore` and create `.env.example` with variable names only.
- [x] Align context/spec documentation with external Zoom links, no video recordings, and teacher mobile dashboard requirements.
- [x] Update payroll rule: teacher report triggers scheduled-duration hourly credit and student deduction in one transaction.
- [x] Remove Zoom event, attendance threshold, overlap-billing, recording, and reconciliation requirements from the documentation.
- [x] Confirm application fields (FINAL, 2026-10-03) and TeacherRates design (effective-dated table, Phase 6). Still open: login identifier (username PROPOSAL), report values, attachment cap, rounding, zero-session mechanism.
- [x] Confirm unified immutable Reports: Teacher + Student + Session FKs; `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; Admin approval gates settlement; no revision/version table.
- [x] Confirm SessionStudents is the persisted attendance source; evaluations are separate and missing evaluation is not absence.
- [ ] Decide whether student evaluation is mandatory after every completed session.

## 2026-10-03 Confirmed owner decisions (all marked CONFIRMED in CONTEXT.md §7 and the phase-02 spec)

1. **Application fields (FINAL):** Guardian: `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `children[] {name, age, subjects[]}`, `preferred_times` (optional), `notes` (optional). Student: `full_name`, `date_of_birth`, `phone_whatsapp`, `timezone`, `preferred_language`, `subjects[]`, `level`, `preferred_times` (optional), `notes` (optional); if under 18: `guardian_name`, `guardian_phone`, `guardian_relationship` (father|mother) required. Teacher: `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `subjects[]`, `years_experience`, `qualifications`, `available_times` (optional), `notes` (optional) — `expected_hourly_rate`/`currency` removed (pay agreed with Admin by human contact, entered by Admin later). Honeypot, size limit, per-IP rate limit kept.
2. **Provisioning:** every child gets their own username + temporary password; a guardian application with N children = 1 guardian user + N student users, created in ONE transaction (all or nothing) and idempotent.
3. **Guardian linking:** Admin links a student to an existing guardian or creates the guardian in the same approval step; manual adds from the dashboard any time (guardian, student, teacher, subject, another admin); credentials shown to Admin ONCE, delivery by WhatsApp later via `MessagingProvider` (fake provider only).
4. **Site config:** logo still being made and contact info comes later — clearly marked placeholders in a site config module; invent nothing (no claims, no prices).
5. **Database for tests:** NO Docker and NO separate test database — the owner's Supabase DB used directly (contains no real data). `db:seed:demo` (academy, admin, demo guardians/students/teachers; every demo username starts with `demo_`), `db:clear:demo` deletes ONLY `demo_*` records, tests create unique `demo_test_*` records and delete them afterwards. **Phase 6 exception (documented, implemented only in Phase 6):** after append-only ledgers exist, demo data can still be cleared with these guards: (1) only records linked to `demo_*` users/teachers; (2) only via the dedicated `db:clear:demo` script — the append-only trigger is NEVER dropped or disabled globally; (3) abort if any non-demo record references the same session/report/subscription; (4) explicit `--confirm` flag and print the counts first; (5) refuse to run when `NODE_ENV=production`.
6. **TeacherRates = effective-dated table** (`id, teacher_id, hourly_rate_minor, currency, effective_from, created_by`) — CONFIRMED. Built in Phase 6, NOT now. Rate rule CONFIRMED: a session is paid with the row whose `effective_from <=` the SESSION's scheduled start (not the approval time); the ledger credit stores `hourly_rate_snapshot_minor`.

## 2026-10-03 Phase 1 audit and gap fixes

- Phase 1 audited against the repo: typecheck, lint, build, and `prisma migrate status` verified clean; tests and next-intl were missing.
- Audit deviations: init migration includes the Phase 2 `applications`/`subjects` tables; auth is next-auth v4 with username-first login; `Users` has `username` + nullable email (differs from `database-schema.md`).
- Gap fixes committed on `feature/phase-1-foundation`: branch created; previous work committed separately (docs `16b8371`, Phase 1 `118e4d6`, Phase 2 `14ec222`); `docs.zip` removed; `!.env.example` added and `.env.example` committed; three broken npm scripts deleted (`prisma migrate status`/`reset` cover them); login now redirects to the role dashboard.
- Blocked on owner: secrets rotation (seed not run), brand logo files, landing-page copy (what the academy teaches, contact info), final application form fields.

## 2026-09-30 Documentation Update

- Prompt A: corrected the schema, business model, and progress index for manual Zoom links, report-based attendance, prepaid sessions, hourly pay, append-only ledgers, and raw SQL constraints.
- Prompt B: phase-spec upgrade is next and must consume the corrected schema without editing it.

## 2026-09-30 Report Architecture Update

- Reports are one immutable historical entity linked to Session, Teacher, and Student. Rejected reports return to the teacher for correction; approved reports settle atomically and become archived.
- Settlement requires Admin approval, is idempotent, and rolls back both ledger effects on failure. Completed sessions may have missing reports.

## Post-delivery SaaS roadmap

Documented only for now: multi-academy onboarding and billing, tenant administration, RLS and tenant switching, tenant-scoped uniqueness, provider configuration, and an optional future Zoom verification layer. No current phase creates tasks for this roadmap.
