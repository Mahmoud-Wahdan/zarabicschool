ROLE: You are the implementation agent for the Zarabicschool project. The owner (Mahmoud) has said "start implementation". Work in small verified steps and stay inside the scope below.

PROJECT LAYOUT
- The Next.js app is in `webapp/`. Project documentation is in `docs/` (repo root).
- Read FIRST, in this order: docs/CONTEXT.md, docs/INSTRUCTIONS.md, docs/specs/PROGRESS.md, docs/specs/database-schema.md, docs/specs/phase-01-foundation.md, docs/specs/phase-02-educational-management.md. Skim the other phase files only for context.
- CONTEXT.md is the source of truth. Some older text in docs/specs/business-model.md and phase-04..08 still describes Zoom events, SMS as confirmed, deduction at attendance, overlap billing, reconciliation. IGNORE those leftovers. Financial rule that matters for the schema: the student's session deduction and the teacher's credit both happen only after Admin approves the teacher's per-student report (CONTEXT §7).

TODAY'S GOAL (a complete, demo-able result by the end of the day)
1. Prisma set up correctly.
2. The FULL schema from docs/specs/database-schema.md migrated to the dev database (the owner wants the whole schema now; migrations are disposable until the first real data).
3. Seeds: a minimal production-safe seed (academy + admin) and a big DEMO seed for the front-end.
4. Backend for the public application forms (3 types).
5. Arabic-first RTL landing page with the 3 application tabs and their forms, wired to the backend.
6. A dev-only read-only preview page that shows the seeded data.
7. the all login logic and the dashboard of admin to only approve the 3 forms and login for these 3 the full login flow
NOT TODAY:WhatsApp/OpenWA, Zoom, payments, the settlement service, notifications, any business logic beyond what is listed here.

HARD RULES
- Never print, log, or commit secret values (DATABASE_URL, DIRECT_URL, passwords, keys). Env variable NAMES only. `.env` stays git-ignored; keep `.env.example` complete with names only.
- Do not add or upgrade dependencies without asking, EXCEPT these approved ones: `@prisma/adapter-pg`, `pg`, `@types/pg`, `tsx`, `dotenv` (already installed with the pinned versions). Prisma family stays pinned to exact 7.10.0. No RC/beta packages.
- Do not invent business rules. Where docs/specs/database-schema.md marks something OPEN or "DECISION REQUIRED", implement the option the spec RECOMMENDS, add a `// OPEN:` comment, and list it in your final report. Specifically: `class_remark` = plain String (no enum yet); `attendance_outcome` enum = ATTENDED, STUDENT_ABSENT only; Users.email stays as the spec says (login identifier is OPEN); TeacherRates = effective-dated table.
- Before ANY `prisma migrate` command: print only the database HOST NAME (never credentials) and wait for the owner to confirm it is the dev database.
- Commit after each numbered step below with a descriptive message. Do not commit generated Prisma client output or `.env`.
- After each step, tell the owner in 3–6 lines: what changed, which files, how you verified it, what is risky. If something in the spec is ambiguous or contradictory, STOP and ask.

STEP 0 — Environment check
- Verify Node version, `npx prisma -v` (CLI and client both 7.10.0), `npm ls` has no invalid/unmet peers. Stop and report if not.

STEP 1 — Prisma 7 setup
- `prisma.config.ts` (import "dotenv/config"; schema path; migrations path; seed command `tsx prisma/seed.ts`; datasource url from DIRECT_URL for migrations). Check the exact syntax against the installed version's docs.
- Generator `prisma-client` with output `generated/prisma` (git-ignored). Runtime client uses `@prisma/adapter-pg` with DATABASE_URL (pooled). Scripts (seed/verify) may use DIRECT_URL.
- `lib/prisma.ts`: server-only singleton (cached on globalThis in dev). Make sure imports work with Next 16 and TypeScript config for the ESM client.
- Add npm scripts: `db:generate`, `db:migrate`, `db:seed`, `db:seed:demo`, `db:verify`, `db:reset:dev` (reset + seed + demo; refuses to run if NODE_ENV=production).

STEP 2 — Full schema (tables first)
- Translate EVERY table/enum in docs/specs/database-schema.md into `prisma/schema.prisma`: UUID ids, TIMESTAMPTZ, snake_case table/column names via @map/@@map, explicit relation names where two FKs point to one model, `academy_id` on tenant-owned tables, unique constraints and indexes as specified, restrictive delete behavior (no cascading deletes on anything a ledger references).
- Run `prisma validate`, then create migration #1 (tables only). Inspect the generated SQL for foreign-key delete actions before applying.

STEP 3 — Base seed (`prisma/seed.ts`, production-safe, idempotent)
- Upsert one stable Zarabicschool academy row and one Admin user. Read SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME from env, bcrypt-hash the password, set must_change_password = true. Never print the password. Running it twice must not create duplicates.

STEP 4 — Application backend
- Shared Zod schemas in `lib/validation/application.ts` (used by both server and client): a discrimina ted union on `type` = GUARDIAN | STUDENT | TEACHER.
- FIELDS (PROPOSAL from the owner's discussion; the owner may edit later — keep them in ONE place):
  - Common: full_name (2–100), phone_whatsapp (required; normalize to E.164; default country Egypt), email (optional), timezone (IANA, default Africa/Cairo), preferred_language (ar|en, default ar), notes (optional, ≤1000).
  - GUARDIAN: children[] (1–10 items: name, age 3–25, subjects[]), preferred_times (optional text).
  - STUDENT: date_of_birth (required; compute adult/minor, adult = 18+), subjects[] (≥1), level (beginner|intermediate|advanced), preferred_times (optional). If minor: guardian_name, guardian_phone, guardian_relationship (father|mother) are REQUIRED. If adult: guardian fields are not required (the schema allows an adult student without guardian).
  - TEACHER: subjects[] (≥1), years_experience (0–50), qualifications (≤1000), expected_hourly_rate (> 0, stored as integer minor units) + currency (ISO: USD|EGP), available_times (optional text).
- `GET /api/subjects` returns id + name of active subjects for the form choices.
- `POST /api/applications` (route handler): same-origin check (Origin header), JSON body size limit, Zod validation, honeypot field (silently accept-and-drop bots), in-memory IP rate limit (e.g. 5 per 10 minutes; isolate it behind a small interface so it can move to a shared store later), duplicate protection (same phone + type within 24h → 409), persist to Applications with status NEW and the single seeded academy (look it up from the DB; NOT an env var), type-specific data in `details` (JSONB) per the spec. Return 201 `{ id }` only. Consistent error shape `{ error: { code, message, fieldErrors? } }` with 400/409/413/429. NEVER log names, phones, emails or any minor's data.
- Unit tests (Jest via `next/jest`): every Zod branch (adult vs minor student, invalid rate/currency/phone), honeypot, rate limiter, duplicate detection. Add the `test` script. If Jest cannot import the ESM Prisma client, isolate DB access behind a repository function and test the rest; report this instead of hacking config.

STEP 5 — Landing page (Arabic-first RTL)
- Replace the Create Next App starter. `app/layout.tsx`: lang="ar", dir="rtl", metadata, fonts via next/font (Cairo headings, Tajawal body, Montserrat for English), brand tokens in Tailwind/CSS: Navy #1B365D, Emerald #00897B, Gold #D4AF37 (≈60% neutral, 30% navy/emerald, 10% gold).
- `next-intl` configured with `ar` default; `ar` messages complete; `en` messages at least for the form and navigation. No logo files exist in the repo: use a text wordmark placeholder, do NOT invent a logo.
- Sections: hero (tagline "تعلّم العربية والقرآن ... بنيَة تضيء قلبك"), how it works (apply → Admin reviews → you receive your username and password), subjects (from the database), the application section, footer.
- Application section = accessible tablist with 3 tabs (ولي أمر / طالب / معلم): proper ARIA roles, keyboard navigation, one form per tab with the fields above, conditional minor/adult branching in the student form, client-side Zod validation with field-level Arabic error messages, pending/success/error states, honeypot input hidden from users and screen readers, mobile-first layout, no dangerouslySetInnerHTML.
- Do NOT create accounts or send messages. Success message: the application was received and will be reviewed by the administration.
- Component tests (React Testing Library): tab switching, student adult/minor branching, validation feedback, submit success and error states.

STEP 6 — Database invariants (raw SQL migration #2, separate from migration #1)
- From docs/specs/database-schema.md "Prisma Notes / Raw SQL Steps": partial unique indexes (one SESSION_DEDUCTION per (session, subscription); one SESSION_CREDIT per session; one completion report per (session, student)), CHECK constraints (amount signs, currency length, time ordering), append-only triggers on SubscriptionLedger and PayrollLedger (raise on UPDATE and DELETE), ON DELETE RESTRICT where required.
- `scripts/verify-db.ts` (`npm run db:verify`) inside a transaction that is rolled back: proves a duplicate deduction, duplicate credit and duplicate report are REJECTED, UPDATE/DELETE on both ledgers are REJECTED, a bad time interval is REJECTED, and a valid Application insert works. Print PASS/FAIL per check. No settlement business logic — that is Phase 6.

STEP 7 — Demo seed (`prisma/seed-demo.ts`, DEV ONLY)
- Refuses to run unless NODE_ENV !== "production" AND SEED_DEMO === "true". Idempotent (natural keys / upserts). All data obviously fake: fake names (Arabic and English), obviously fake phone numbers, fake emails on a reserved domain (example.com), fake Zoom links like https://zoom.us/j/0000000000 — never real. Passwords come from SEED_DEMO_PASSWORD, bcrypt-hashed, never printed.
- Data: 4 subjects (e.g. Quran, Arabic language, Islamic studies, Tajweed); 3 teachers with TeacherRates (mix EGP/USD) and TeacherSubjects; 3 guardians; 6 students (5 minors linked to guardians, 1 adult without guardian); Enrollments (CONFIRMED and PENDING); Subscriptions (8-session package) with paid Invoices and INITIAL_PURCHASE ledger rows; about 15 Sessions (past and upcoming, private and group, one recurrence group, one replacement session) with SessionStudents; several ATTENDED reports with matching, CONSISTENT settlement rows (one SESSION_DEDUCTION per attending student, ONE SESSION_CREDIT per session with minutes_credited and rate snapshot, Reports.settled_at set) written by a small helper inside the seed only (mark it "demo helper — the real settlement service is Phase 6"); one STUDENT_ABSENT report with no money movement; one TeacherFlag; one SessionRequest; one Complaint; one Announcement; 3 Applications (one per type, statuses NEW/REVIEWED); a few NotificationLog rows (no passwords).
- Also verify the ledger consistency query from the schema spec returns zero inconsistencies after seeding.

STEP 8 — Dev-only preview
- `/dev/preview`: server component, read-only, calls `notFound()` when NODE_ENV === "production". Shows counts per table and small tables: teachers with rates, students with guardians and remaining sessions, upcoming sessions, latest applications, teacher balances per currency. No editing, no auth (it is dev-only; say so clearly on the page).

STEP 9 — Verify and report
- Run: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`, `npm run db:verify`, and start `npm run dev`. Manually check the landing page at mobile and desktop widths in RTL, submit all three forms, and confirm rows in Applications through /dev/preview.
- Update docs/specs/phase-01-foundation.md and docs/specs/PROGRESS.md execution logs with what was really done (and what was not). Do NOT edit any other doc.
- Final report: files created/changed; commands run and their real results (never claim a check passed if you did not run it); every `// OPEN:` decision you implemented by default; anything you could not finish; risks; and the exact commands the owner should run to reproduce (`db:reset:dev`, `dev`).