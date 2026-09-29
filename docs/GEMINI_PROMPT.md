# Prompt — paste in full as the first message to Gemini

Before writing any code, your task right now is to create the documentation structure (`docs/specs/`) only — no application code.

## Step 1 — Read both files completely first
- `docs/CONTEXT.md` (stable project facts and decisions)
- `docs/INSTRUCTIONS.md` (engineering behavior rules, especially Section 22 "Docs/Specs Living-Phase Protocol")

If the files are not in the repo yet, stop and ask me to upload them. Do not continue without reading them.

## Step 2 — Create the `docs/specs/` structure exactly as follows

```
docs/
  CONTEXT.md          (already exists)
  INSTRUCTIONS.md     (already exists)
  specs/
    PROGRESS.md
    business-model.md
    database-schema.md
    phase-01-foundation.md
    phase-02-educational-management.md
    phase-03-schedules-sessions.md
    phase-04-live-learning-zoom.md
    phase-05-attendance-recordings.md
    phase-06-financial-management.md
    phase-07-admin-reports.md
    phase-08-testing-launch.md
```

### `PROGRESS.md`
A simple table: Phase name | Status (Not Started / In Progress / Done) | Last updated | Short note. All 8 phases start as "Not Started".

Add an "Action items" section, seeded with exactly these items (unchecked):
- [ ] Rotate all secrets that were exposed during setup (database password, Zoom client secret, JWT/NextAuth secrets) before any real data is stored.
- [ ] Give `JWT_SECRET` and `NEXTAUTH_SECRET` different values.
- [ ] Verify the academy's Zoom plan (Server-to-Server OAuth, WebSocket event subscription, REST endpoints needed for reconciliation).
- [ ] Confirm which Zoom account owns the Server-to-Server OAuth app (events only arrive from that account).
- [ ] Inform Alaa about Zoom cost.
- [ ] Decide hosting / long-running process model (WebSocket client, OpenWA, and BullMQ workers cannot run on serverless).
- [ ] Confirm Supabase as the final Postgres host.
- [ ] Ensure `.env` is in `.gitignore` and create `.env.example` with variable names only.

### `business-model.md`
Summarize from `CONTEXT.md` (invent nothing new): the four roles, the student journey, and the automatic payroll logic (Zoom "meeting ended" event → deduct from the student's subscription → credit the teacher). Label every business decision as Confirmed or Open, and do not resolve open ones yourself. At minimum list these as Open:
- what happens when a student's subscription balance runs out mid-cycle;
- exact recipients of each WhatsApp notification;
- whether the 3-minute late threshold affects payroll;
- how account credentials are delivered to students/guardians (WhatsApp goes through an unofficial provider and can be banned — fallback? activation link? forced password change?);
- reconciliation policy: how sessions are verified if the WebSocket was disconnected when a meeting ended (who verifies, how often, what if Zoom data is unavailable).

### `database-schema.md`
Propose the core tables: Users, Roles, Students, Guardians, Teachers, Subjects, Sessions, Attendance, PayrollLedger, Invoices, Reports/Evaluations, Announcements, plus: Applications/Leads, Subscriptions (student balance), PaymentProofs, ZoomEvents (raw provider events with a unique constraint for idempotency and a `source` column: live WebSocket vs. reconciliation, for audit), NotificationLog, Recordings.
Include columns and logical relations, but put every table under the heading "Proposed — needs review" and do not treat it as final. If a decision is unresolved in `CONTEXT.md` (e.g. the shape of `academy_id`, PayrollLedger details), write an explicit question instead of assuming an answer. Money is stored as integer minor units.

### Each `phase-0X-...md`
Use the same template for all 8 files:

```markdown
# Phase X — [Name]

## Goal
[Short paragraph from CONTEXT.md Section 13]

## Proposed approach
[General technical steps — no sensitive architectural decisions that are still unresolved]

## Tasks
- [ ] Task 1
- [ ] Task 2
...

## Execution log (updated as soon as real work happens)
(empty for now)
```

## Step 3 — The most important rule (applies to every future session, not just now)
Before any new work in any future session: read `PROGRESS.md` and the current phase file first, and continue from where the last session stopped. Never recreate any of these files from scratch. After any real work, update the Tasks and the log in the phase file, and update its status in `PROGRESS.md`.

## Step 4 — Rules for everything you write
- For every requirement, label it: confirmed / proposal / open question / assumption.
- Surface conflicts between documents instead of choosing silently.
- Do not invent business rules; list them as questions for the owner.
- Zoom events arrive over a WebSocket; there are no webhooks in this project. Do not write webhook-based designs.
- Never write secret values (keys, tokens, passwords) anywhere in the docs. Environment variable names only.
- Write the docs in English.

## Step 5 — When the structure is done
Print only a summary (not the full files): the number of files created, and every open question or decision you found while writing `business-model.md` or `database-schema.md` that I must answer before any real code.

Do not start any application code in this session. This is a documentation session only.
