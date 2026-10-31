# Zarabicschool

An online academy platform for live one-to-one and group lessons (Arabic, Quran and more), built for an Egyptian academy that teaches students in many countries.
It runs the whole academy: admissions, scheduling, live sessions on Zoom, attendance and session reports, payments, teacher payroll and WhatsApp notifications.
It works in Arabic (right-to-left) and English, and shows every time in each user's own time zone.

## Who uses it

| Role | What they do |
|---|---|
| **Admin** | Runs everything: admissions, people, scheduling, finances, payroll, WhatsApp, analytics |
| **Supervisor** | Day-to-day operations without money: approves session reports, handles absence requests and complaints, follows teachers |
| **Teacher** | Sees their timetable, joins sessions, writes a report per student, writes monthly reports, sees their own pay |
| **Guardian** | Follows their children: timetable, reports, homework, attendance, invoices; files complaints and rates sessions |
| **Student** | Joins sessions, reads homework and reports, follows attendance; an adult student also pays their own invoices |

## Features

- **Admissions:** a public application form, and an Admin review that creates the family accounts in one step and sends the sign-in details on WhatsApp.
- **Scheduling:**
  - single sessions and weekly series, rescheduling and cancellation;
  - teacher-overlap checks;
  - a teacher schedule board;
  - week, month and table calendars on every dashboard.
- **Live sessions:**
  - students join through a platform link that opens a set time before the start and logs each click;
  - raw Zoom links are never sent in messages or shown in lists.
- **Reports and attendance:**
  - a report per student in the student's own report language;
  - Supervisor approval, which settles the session (consumes the credit, counts the teacher's pay);
  - monthly reports, plus reminders and flags for late reports.
- **Credits and billing:**
  - monthly plans and session credits; invoices in EGP through Paymob;
  - partial refunds; a payment audit trail;
  - a renewal grace period that blocks new bookings when it ends.
- **Teacher payroll:** hourly rates with effective dates, bonuses, deductions and overtime review.
- **Family care:**
  - complaints with a NEW → IN_PROGRESS → RESOLVED flow;
  - session evaluations that the teacher never sees;
  - absence and outage requests that can trigger a replacement session.
- **Communication:**
  - announcements to the whole academy and an in-app inbox;
  - WhatsApp messages through a self-hosted OpenWA gateway, sent by a background worker with retries.
- **Dashboards:**
  - a dashboard for each role;
  - an Analytics page with charts and a table view of every chart;
  - sortable and filterable tables with Excel (CSV) export.
- **Interface:** Arabic and English, right-to-left aware, light, dark and device themes, and a mobile layout.

## Security

- Roles are checked on every page (in `proxy.ts` and in each page) and on every API handler.
- Every query is scoped to the user's academy (multi-tenant).
- State-changing requests are refused unless they come from the app's own origin.
- Signed webhooks for Paymob and OpenWA.
- Login lockout after 3 wrong passwords in 15 minutes, plus rate limits.
- Passwords are hashed with bcrypt, and a first sign-in forces a password change.
- Security headers: a nonce-based Content-Security-Policy on every page, HSTS and others.
- Automated OWASP Top 10 checks in the browser test suite.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Components), React 19, TypeScript |
| Database | PostgreSQL, Prisma 7 with the `pg` adapter |
| Auth | NextAuth (credentials), bcrypt |
| Validation | Zod |
| i18n | next-intl (Arabic RTL and English) |
| Styling | Tailwind CSS 4 with design tokens (light and dark) |
| Payments | Paymob (EGP) |
| WhatsApp | OpenWA (self-hosted gateway) |
| Files | Cloudinary (private assets, signed uploads) |
| Tests | Jest (unit and integration on a real Postgres), Playwright (end-to-end, accessibility with axe) |

## Repository layout

```
zarabicschool/
├── webapp/                 the application
│   ├── app/                pages ([locale]/...) and API routes (api/...)
│   ├── lib/                business logic (scheduling, credits, payroll, messaging, worker, ...)
│   ├── prisma/             schema.prisma and migrations
│   ├── messages/           ar.json and en.json
│   ├── __tests__/          Jest tests
│   ├── e2e/                Playwright tests
│   ├── proxy.ts            route guard and security headers
│   └── scripts/worker.ts   the background worker as its own process
├── docs/
│   ├── specs/              decisions, plans, deploy checklist, staging runbook, deployment guide
│   └── learn/              a beginner's guide to the code (Arabic)
└── OpenWA/                 the WhatsApp gateway (a separate clone, not tracked here)
```

## Getting started (local)

Requirements: Node.js 22+, PostgreSQL 16, and optionally OpenWA for WhatsApp.

```bash
git clone https://github.com/Mahmoud-Wahdan/zarabicschool.git
cd zarabicschool/webapp
npm install
cp .env.example .env          # then fill in the values (never commit .env)
npx prisma generate
npx prisma migrate deploy     # creates the tables
npx tsx prisma/seed.ts        # the academy and the first Admin (from SEED_ADMIN_*)
npm run dev                   # http://localhost:3000
```

Every variable is described in `.env.example`.
- **Worker placement:** with `WORKER_MODE` empty, the worker runs inside the web server. Set it to `separate` and start it on its own with `npm run worker`.
- **Development messaging:** `MESSAGING_PROVIDER=console` prints WhatsApp messages to the terminal instead of sending them. A production start refuses this setting.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm run start` | production build and server |
| `npm run worker` | the background worker (notifications, retries) |
| `npm run lint` | ESLint |
| `npm test` | Jest suite (needs a Postgres database) |
| `npx playwright test` | end-to-end suite (builds a test academy, then removes it) |
| `npm run db:verify` | read-only database health checks |

## Tests

- **Jest:** 106 test files and 842 tests. They cover the business rules, security guards, time zones and translation keys, running against a real Postgres.
- **Playwright:** 122 tests and no skipped ones.
  - every page for every role in Arabic and English;
  - an accessibility scan (WCAG 2.1 A/AA) of every menu page;
  - a story that crosses all five roles;
  - payments against a Paymob test double;
  - WhatsApp through OpenWA;
  - OWASP Top 10 checks.

## Deployment

See [`docs/specs/deployment-guide.md`](docs/specs/deployment-guide.md). It covers Supabase, Vercel for the web app, and Railway (or a local machine) for the worker and OpenWA.
The launch checklist is in [`docs/specs/deploy-checklist.md`](docs/specs/deploy-checklist.md).

## License

Private project. All rights reserved.
