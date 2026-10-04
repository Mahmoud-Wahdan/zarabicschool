# Phase 1 — Foundation

## Goal

Platform structure, login, accounts, permissions, basic dashboards. (CONTEXT.md §13, Phase 1.)

Set up the core infrastructure: Next.js project with App Router, TypeScript, Tailwind CSS, RTL/Arabic-first layout (`next-intl`), PostgreSQL via Prisma, authentication (NextAuth/Auth.js), role-based access control for the four roles, login rate limiting, forced password reset flow, and skeleton dashboards for each role.

## Proposed approach

1. **Project Scaffolding:** Initialize Next.js (App Router) with TypeScript, Tailwind CSS, and ESLint. Configure `next-intl` with Arabic as primary language, English as secondary, RTL as default layout direction.
2. **Brand Integration:** Apply brand colors (Navy `#1B365D`, Emerald `#00897B`, Gold `#D4AF37`) and typography (Cairo/Tajawal for Arabic, Montserrat for English) to the Tailwind config.
3. **Database Setup:** Connect Prisma to PostgreSQL on Supabase. Use `DATABASE_URL` (pooler, transaction mode) for queries and `DIRECT_URL` for migrations. Create initial migration for `Academies` and `Users` tables. Seed single `academy_id` UUID.
4. **Authentication & Security:**
   - Configure NextAuth/Auth.js with credentials provider (email + temporary password created by Admin).
   - Implement bcrypt password hashing.
   - Enforce `must_change_password`: on first login, redirect user to a password change screen before granting access to platform features.
   - Enforce login rate limiting: in Phase 1 local development, use an in-memory / local token bucket rate limiter (transitioning to Redis when BullMQ is introduced).
5. **RBAC Middleware:** Protect routes by role (`ADMIN`, `TEACHER`, `STUDENT`, `GUARDIAN`). Admin sees all; others see strictly scoped dashboards.
6. **Dashboard Shells:** Create base responsive layouts for each role with role-specific navigation tabs.
7. **Environment:** Create `.env.example` with variable names only. Verify `.env` is ignored by Git. No `ZOOM_*` variables.

Delivery stage: Stage 1.

## Acceptance criteria

- Every authenticated request rejects inactive users and users who must change their password until the change succeeds.
- Login throttling uses identifier and IP keys; the test database, CI lint, typecheck, test, and build commands are documented and runnable.

## Frontend

Routes: `/login`, `/change-password`, `/admin`, `/teacher`, `/student`, `/guardian`. Provide loading, empty, and error states, Zod-backed forms, Arabic RTL and English translations, and mobile-first role visibility. Deactivated users are sent to a signed-out state.

## Backend

Use Auth.js credentials handlers and route/server-action guards. Validate login and password-change payloads with Zod. Return `{ error: { code, message, fieldErrors? } }` with 400/401/403/429. No background job is required for auth. Open scheduler decision remains BullMQ + Redis versus database polling.

## Database

Touches `Academies` and `Users`: username decision OPEN, password hash, timezone, `is_active`, `must_change_password`, and `password_changed_at`. Seed one academy and an Admin. Use `DIRECT_URL` for migrations; do not create Zoom tables.

## Auth & Authorization

| Role | Login | Change own password | View own dashboard | Admin routes |
|---|---:|---:|---:|---:|
| Admin | Yes | Yes | Yes | Yes |
| Teacher/Student/Guardian | Yes | Yes | Yes | No |

Enforce this server-side. An inactive user's session is rejected on the next request and cannot refresh into an active session.

## Security

Hash passwords with bcrypt; never log passwords or student identifiers; validate and rate-limit login; use secure session cookies; keep env values out of docs; audit deactivation and password changes.

## Transactions & failure handling

Password change updates the hash, timestamp, and `must_change_password` flag atomically. Failed changes leave the old credential and gate intact.

## Tests

Unit: password policy and rate-limit key calculation. Integration with real Postgres: inactive session rejection, forced-password gate, failed change rollback, identifier+IP throttling. Playwright: login, forced change, role redirects, and deactivated-session termination.

## Learning checkpoint

- Why must `must_change_password` be enforced in the server authorization path?
- What happens to an existing session after `is_active` becomes false?

## Open decisions

- Full schema migration now versus per-phase migrations; recommend per-phase.
- Public application intake in Phase 1 versus Phase 2.
- Scheduler choice and login identifier.

## Deferred / Post-MVP

- [DEFERRED] Shared Redis rate-limit storage and advanced session management.
- [DEFERRED] SaaS tenant switching and RLS.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [x] Initialize Next.js project (App Router, TypeScript, Tailwind CSS)
- [x] Configure `next-intl` (Arabic primary, English secondary, RTL layout) *(slice A3: `[locale]` routing, ar/en messages, locale-aware auth flows, dashboards, 404; verified typecheck/lint/build 2026-10-03)*
- [x] Apply brand colors and typography to Tailwind config
- [x] Set up Prisma with PostgreSQL (Supabase pooler + direct URL)
- [x] Create initial migration: `Academies`, `Users` tables
- [ ] Seed script: create single `academy_id` UUID + initial Admin user *(script written and reviewed; NOT executed — awaiting owner confirmation that secrets are rotated)*
- [x] Set up NextAuth/Auth.js credentials authentication
- [x] Implement password hashing (bcrypt)
- [x] Implement `must_change_password` first-login gate & password change form
- [x] Implement login rate limiting (local in-memory implementation for Phase 1)
- [x] Implement RBAC middleware (route protection by role)
- [x] Create responsive RTL layout with brand styling
- [x] Create dashboard shell pages for Admin, Teacher, Student, Guardian
- [x] Create `.env.example` with variable names only
- [x] Verify `.env` in `.gitignore`
- [ ] Write tests: auth credentials flow, `must_change_password` enforcement, rate limiting, RBAC route guarding
- [x] REMOVED — all `ZOOM_*` environment variables; the MVP has no Zoom API.

## Execution log (updated as soon as real work happens)

- 2026-09-30: Documentation aligned with the fifth context revision; frontend target is `webapp/`, and Zoom API/event requirements are removed.
- 2026-10-01 (audit): Verified against the repo — typecheck, lint, `next build`, and `prisma migrate status` all clean (migration `20260930155035_init` applied to Supabase). Audit deviations recorded: (1) the init migration also creates the Phase 2 `applications`/`subjects` tables — already applied, not split retroactively; (2) auth is next-auth **v4** (not Auth.js v5) with a username-first credentials provider; (3) `Users` uses `username` (`UNIQUE(academy_id, username)`) + nullable email, which differs from `database-schema.md` — login identifier remains an OPEN owner decision; (4) login landed on `/` instead of the role dashboard (fixed in `d10eb90`); (5) three npm scripts (`db:seed:demo`, `db:verify`, `db:reset:dev`) pointed to non-existent files and were deleted — built-in `prisma migrate status` / `prisma migrate reset` cover those needs; (6) tests did not exist; (7) `.env.example` was ignored by the `.env*` pattern (fixed with `!.env.example`, committed in `f90d203`).
- 2026-10-01 (slices): Work moved to branch `feature/phase-1-foundation`. Committed the previous session's uncommitted work as separate commits: docs sync (`16b8371`), Phase 1 foundation (`118e4d6`), Phase 2 start (`14ec222`). Slice A2 fixes verified (typecheck/lint/build) and committed (`d10eb90`, `f90d203`). Seed intentionally NOT run until the owner confirms secret rotation.
- 2026-10-03 (slice A3 — next-intl finished): The owner moved all pages under `app/[locale]/`, fixed their relative imports, and edited `layout.tsx` (NextIntlClientProvider, `lang`/`dir` per locale, `LayoutProps<"/[locale]">`). Completed: `next.config.ts` next-intl plugin; `i18n/routing.ts` (`ar` default, `en`), `i18n/request.ts`, `i18n/navigation.ts`; `messages/ar.json` + `en.json`; login form uses `useLocale`/`useTranslations` with a locale-aware destination (`/{locale}/change-password` or `/{locale}/{role}`); change-password page + form locale-aware; dashboard shell + 4 role dashboards fully translated; sign-out button locale-aware (`callbackUrl: /{locale}/login`); `LocaleSwitcher` on home, login, and dashboard shell; `[locale]/not-found.tsx` + `[locale]/[...rest]/page.tsx` catch-all; `requireRole` in `lib/dal.ts` redirects with the locale prefix (interim `dashboardPath` removed); `proxy.ts` is locale-aware (strips the locale for role checks, preserves it in redirects, runs next-intl routing last). Verified: `tsc --noEmit` clean, `eslint` clean, `next build` clean (all `[locale]` routes + proxy listed). No tests exist yet (slice A4).
- 2026-10-03 (slice B — landing page): `lib/site-config.ts` created with brand name, the confirmed tagline (ar/en), and clearly marked `null` placeholders for the logo and contact info (owner decision: invent nothing; hero renders a temporary text mark until the logo arrives). Landing page (`app/[locale]/page.tsx`) extended with "what we teach" (Arabic and Quran only) and "how it works" (apply → Admin reviews → credentials by WhatsApp → login) sections from messages; the three application entry points keep their "coming soon" badges until the forms are built (slice C). Cairo applied to headings in `globals.css`; body remains Tajawal. Metadata per locale comes from `[locale]/layout.tsx` (home namespace). Verified: `tsc --noEmit` clean, `eslint` clean, `next build` clean. No tests exist yet (slice A4).
- 2026-10-03 (slice B+ — full landing page): Landing copy moved to the new messages key tree (brand/common/nav/hero/features/subjects/why/steps/apply/faq/closing/footer/comingSoon); login/changePassword/dashboard/notFound namespaces merged back from git HEAD so the Phase 1 auth pages keep working; a11y keys added (`nav.openMenu`, `nav.closeMenu`, `common.skipToContent`). Landing page rebuilt from section components under `app/_components/landing/`: sticky SiteHeader (anchors #subjects #steps #why #faq #apply, langSwitch toggle, Login → /login, Apply now → #apply, hamburger with Escape/aria-expanded), Hero (arch-framed visual, geometric pattern at ~5% opacity, two CTAs, trust list), FeaturesStrip, SubjectsSection (server component reading the DB: isActive, sortOrder asc, locale picks nameAr/nameEn + descriptionAr/descriptionEn, allowlisted Lucide icon with BookOpen fallback, `subjects.empty` placeholder when empty), WhyUs, HowToStart, ApplyRoles (cards link to `/apply?type=guardian|student|teacher`), FaqAccordion (buttons + aria-expanded/aria-controls), ClosingCta (Apply now → #apply), SiteFooter. `app/[locale]/apply/page.tsx` created (comingSoon copy + back link, reads the guarded `type` query param, renders no forms). `logo-placeholder.tsx` renders next/image only when `siteConfig.logo.src` is set, otherwise an arch-shaped frame labeled with brand.name. Subject model expanded (slug, nameAr/nameEn, descriptionAr/descriptionEn, icon, sortOrder) with migration `20261003120000_subject_bilingual`; `GET /api/subjects` returns the new fields ordered by sortOrder; `lucide-react` added; `db:seed:demo`/`db:clear:demo` scripts added (academy upsert + 5 demo subjects, slugs demo-quran … demo-math, deletable with DELETE WHERE slug LIKE 'demo-%'); database-schema.md Subjects table updated to match.
