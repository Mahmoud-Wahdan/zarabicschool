# S-16 — Admin/Supervisor teacher schedule board (Part C, owner 2026-10-29)

> **Built 2026-10-30** (owner answers D91). No SQL: one new `academy_settings` key; no schema change.

## What the owner asked

- **Day view:**
  - one row per teacher, with the hours running across;
  - each session placed at its exact start and end, labelled with the student's name, or the group name and size;
  - free time visible as empty track;
  - per teacher, the day's session count and hours, highlighted above a threshold (Admin setting, default 6 h/day).
- **Week view** for one teacher.
- **Student filter:** every session of one student, across all teachers.
- **Session form:** after choosing a teacher in the create/edit form, that teacher's day appears under the form.
- **Rules for every view:**
  - times in the viewer's time zone, with no "UTC" label;
  - never a Zoom link;
  - a click opens the session's admin page;
  - the Supervisor sees it too, with no money fields;
  - it reuses `lib/calendar`, checks the ADMIN/SUPERVISOR role on the server, is scoped to the academy, and runs a bounded query.

## Layout (day view, Arabic RTL mirrors it; times in the viewer's zone)

```
 Teacher schedule — Thu 30 Oct 2026 (Africa/Cairo)      [◀ day] [today] [day ▶]   View: (Day) Week   Student: [ all ▾ ]
 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Teacher          │08    09    10    11    12    13    14    15    16    17    18    19    20    21    22  │ Sessions  Hours
 ─────────────────┼────────────────────────────────────────────────────────────────────────────────────┼─────────────────
 Ahmed Hassan     │      [Sara M. 09:00–10:00]      [Group (4) 11:30–12:30]          [Omar 17:00–18:30]  │    3      3.5
 Mona Adel   ⚠    │[Lina 08:00–09:00][Yusuf 09:00–10:00][Group (3) 10:00–12:00]  [Adam 13:00–15:00] … │    6      7.0 ⚠
 Karim Saeed      │                              (no sessions)                                          │    0      0
 ─────────────────┴────────────────────────────────────────────────────────────────────────────────────┴─────────────────
 ⚠ above 6 h/day (Admin setting)   Cancelled / missed: striped, not counted   Click a session → /admin/sessions/<id>
```

- **Hour range:** the hours that hold sessions, rounded out, never less than 08:00–22:00. A session past midnight
  local continues on the next day's board.
- **Phones:** the grid becomes one card per teacher with a time-ordered list and the same totals. No horizontal page scroll.
- **Week view (one teacher):** 7 rows (the week starts Saturday, D47), the same hour track and per-day totals,
  and a week total.
- **Student filter:** the same day or week grid, but rows are only the teachers who have that student that day,
  and only that student's sessions. A group session shows "Group (n)" with the student's name highlighted in the tooltip.
- **Session form:** under the teacher picker, a one-row strip for the chosen teacher and the day of the chosen
  start time. Existing sessions are grey blocks; the new session being entered is an outlined block. An overlap
  shows "overlaps <time>" (display only; the server check stays authoritative, B2 / `assertTeacherFree`).

## Query (bounded)

```ts
// lib/calendar/board.ts (server-only)
const { start, end } = view === "day"
  ? zonedDayRangeUtc(date, viewerZone)                 // 23/25 h on DST days
  : { start: zonedDayRangeUtc(weekStart, viewerZone).start, end: zonedDayRangeUtc(weekEndExclusive, viewerZone).start };
prisma.session.findMany({
  where: {
    academyId,                                          // academy scope
    scheduledStart: { lt: end }, scheduledEnd: { gt: start },   // overlaps the range (sessions crossing midnight)
    ...(teacherId ? { teacherId } : {}),
    ...(studentId ? { students: { some: { studentId } } } : {}),
  },
  orderBy: [{ teacherId: "asc" }, { scheduledStart: "asc" }],
  take: 1000,                                           // hard cap; the response says truncated: true if hit
  select: {
    id: true, scheduledStart: true, scheduledEnd: true, status: true, sessionType: true, teacherId: true,
    students: { select: { studentId: true, student: { select: { user: { select: { displayName: true } } } } } },
  },                                                    // no zoomJoinUrl / zoomHostUrl, no money
});
// + active, APPROVED teachers of the academy (so teachers without sessions show an empty row), at most 300.
```

Totals count only SCHEDULED and COMPLETED sessions. Hours are the minutes inside the viewed day: a session
crossing midnight is split between the two days.

## API contract

`GET /api/admin/schedule-board?date=YYYY-MM-DD&view=day|week&teacherId=<uuid>&studentId=<uuid>&status=SCHEDULED,COMPLETED,CANCELLED,MISSED`
- **Auth:**
  - `requireApiRoles(["ADMIN","SUPERVISOR"])`; TEACHER, STUDENT and GUARDIAN get 403, anonymous 401;
  - ids validated with `z.guid()`; a teacher or student from another academy returns an empty board (no existence leak);
  - `Cache-Control: private, no-store`.
- **Request rules:**
  - `view=week` requires `teacherId` (otherwise 400);
  - `date` defaults to the viewer's today.
- **200 response:**
```json
{ "data": {
  "timeZone": "Africa/Cairo", "view": "day", "range": { "start": "2026-10-29T22:00:00.000Z", "end": "2026-10-30T22:00:00.000Z" },
  "thresholdMinutes": 360, "truncated": false,
  "rows": [ {
    "teacherId": "…", "teacherName": "Mona Adel", "day": "2026-10-30",
    "totals": { "sessions": 6, "minutes": 420, "overThreshold": true },
    "sessions": [ { "id": "…", "start": "…Z", "end": "…Z", "status": "SCHEDULED", "type": "PRIVATE",
                   "studentNames": ["Lina"], "studentCount": 1, "href": "/admin/sessions/…" } ]
  } ]
} }
```
- **Rules for the response:**
  - week view: one row per day for the single teacher;
  - there is no Zoom field, rate, amount, phone or report content anywhere in it;
  - the UI renders times with `formatSessionDateTime(…, viewerZone)` and names the zone, never "UTC".
- **Setting:** `academy_settings` key `schedule.teacher_daily_hours_threshold` (whole hours 1–16, default 6).
  - `GET/PUT /api/admin/settings/teacher-hours-threshold`: ADMIN only, same-origin. The Supervisor only reads
    the value inside the board response.
- **Page:** `/[locale]/admin/schedule` (Admin + Supervisor nav, proxy role list updated). The session form
  reuses the same API with `view=day&teacherId`.

## Tests (TB-01..08)

- TB-01: teacher, student and guardian get 403; anonymous gets 401.
- TB-02: academy isolation. Another academy's teacher or student id returns empty rows; its sessions never appear.
- TB-03: DST day (Africa/Cairo fall-back): the day is 25 h, a session in the repeated hour sits at its real
  instant, and totals are right.
- TB-04: the response text contains no `zoom.us`, `zoomJoinUrl` or `zoomHostUrl`, and no money field.
- TB-05: totals exclude cancelled and missed sessions; the threshold flag works at exactly 6 h and above it.
- TB-06: student filter shows only that student's sessions, across teachers.
- TB-07: a session crossing local midnight is split between the two days' totals.
- TB-08: week view needs `teacherId`; the cap sets `truncated`.
- UI: the RTL grid renders, and a click links to the admin session page (component test). The E2E crawl gets
  the new page for Admin and Supervisor.

## Owner answers (2026-10-30, D91)

- **Filters:** teacher, student and status (scheduled / completed / cancelled / missed), alone or together.
  A filter applies the moment it is selected (no Apply button), and the URL keeps them (`?teacherId=&studentId=&status=`).
  The default status filter is scheduled + completed. Cancelled and missed show only when chosen, and never count in the totals.
- **Daily hours:** scheduled minutes only; gaps are not counted.

## Built (2026-10-30)

- **Server:**
  - `lib/calendar/board.ts` (read model, bounded, viewer zone, academy scope, no Zoom / money fields).
  - `lib/calendar/board-layout.ts` (pure totals: scheduled minutes inside the local day, split at midnight; a flag only ABOVE the threshold).
  - `lib/validation/schedule-board.ts` (filters shared by the API and the page).
  - `lib/config/schedule-board.ts` (statuses, threshold key, default 6 h).
- **API:**
  - `GET /api/admin/schedule-board` (ADMIN + SUPERVISOR, no-store).
  - `GET/PUT /api/admin/settings/teacher-hours-threshold` (ADMIN only).
- **Page `/[locale]/admin/schedule`** (Admin + Supervisor nav, proxy role list):
  - filters for date, day/week, teacher, student and status, each applied on select (`router.replace`, no button);
  - the Admin threshold card;
  - a grid with logical insets (RTL mirrors) and cards on phones.
- **Session form:** under the busy list of the create forms, the chosen teacher's day as a timeline with the new
  session outlined, plus an overlap note (display only; the server check stays authoritative).
- **Tests:**
  - API, written first: `__tests__/api/schedule-board.test.ts` TB-01..08.
  - Component, written after the component: `__tests__/lib/schedule-board-grid.test.tsx` SBG-01..03.
  - The E2E crawl and access control include `/admin/schedule` (day view and week view).
