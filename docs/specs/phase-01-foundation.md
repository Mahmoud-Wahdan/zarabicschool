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

- [ ] Initialize Next.js project (App Router, TypeScript, Tailwind CSS)
- [ ] Configure `next-intl` (Arabic primary, English secondary, RTL layout)
- [ ] Apply brand colors and typography to Tailwind config
- [ ] Set up Prisma with PostgreSQL (Supabase pooler + direct URL)
- [ ] Create initial migration: `Academies`, `Users` tables
- [ ] Seed script: create single `academy_id` UUID + initial Admin user
- [ ] Set up NextAuth/Auth.js credentials authentication
- [ ] Implement password hashing (bcrypt)
- [ ] Implement `must_change_password` first-login gate & password change form
- [ ] Implement login rate limiting (local in-memory implementation for Phase 1)
- [ ] Implement RBAC middleware (route protection by role)
- [ ] Create responsive RTL layout with brand styling
- [ ] Create dashboard shell pages for Admin, Teacher, Student, Guardian
- [ ] Create `.env.example` with variable names only
- [ ] Verify `.env` in `.gitignore`
- [ ] Write tests: auth credentials flow, `must_change_password` enforcement, rate limiting, RBAC route guarding
- [ ] REMOVED — all `ZOOM_*` environment variables; the MVP has no Zoom API.

## Execution log (updated as soon as real work happens)

- 2026-09-30: Documentation aligned with the fifth context revision; frontend target is `webapp/`, and Zoom API/event requirements are removed.
