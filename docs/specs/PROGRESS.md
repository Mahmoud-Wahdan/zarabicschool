# Zarabicschool — Project Progress

> **Protocol:** Always read this file first in any new session. After completing any meaningful chunk of work, update the status table and the current phase's spec file. Never regenerate this file from scratch — extend it.
>
> Last updated: 2026-09-28

## Phase Status

| # | Phase | Status | Last Updated | Note |
|---|-------|--------|--------------|------|
| 1 | Foundation | Not Started | 2026-09-28 | — |
| 2 | Educational Management | Not Started | 2026-09-28 | — |
| 3 | Schedules & Sessions | Not Started | 2026-09-28 | — |
| 4 | Live Learning (Zoom) | Not Started | 2026-09-28 | — |
| 5 | Attendance & Recordings | Not Started | 2026-09-28 | — |
| 6 | Financial Management | Not Started | 2026-09-28 | — |
| 7 | Admin & Reports | Not Started | 2026-09-28 | — |
| 8 | Testing & Launch | Not Started | 2026-09-28 | — |

## Current Active Task

None — documentation structure created; no implementation work started yet.

## Action Items

- [ ] Rotate all secrets that were exposed during setup (database password, Zoom client secret, JWT/NextAuth secrets) before any real data is stored.
- [ ] Give `JWT_SECRET` and `NEXTAUTH_SECRET` different values.
- [ ] Verify the academy's Zoom plan (Server-to-Server OAuth, WebSocket event subscription, REST endpoints needed for reconciliation).
- [ ] Confirm which Zoom account owns the Server-to-Server OAuth app (events only arrive from that account).
- [ ] Inform Alaa about Zoom cost.
- [x] Decide hosting / long-running process model: Confirmed VPS (for Zoom WebSocket, OpenWA, and BullMQ workers).
- [x] Confirm Supabase as the final Postgres host: Confirmed.
- [ ] Ensure `.env` is in `.gitignore` and create `.env.example` with variable names only.
