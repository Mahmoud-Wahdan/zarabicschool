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
7. **Environment:** Create `.env.example` with variable names only. Verify `.env` is ignored by Git.

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

## Execution log (updated as soon as real work happens)

(empty for now)
