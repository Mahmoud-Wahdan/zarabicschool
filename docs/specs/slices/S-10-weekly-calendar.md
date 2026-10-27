# S-10 — Weekly calendar (D13, D27, D30)

> Plan row: `phase-09-plan.md` S-10. Skills: superpowers:test-driven-development, superpowers:verification-before-completion.

## Design
- `lib/calendar/week.ts` (pure): the week starts on **Saturday** (default for the Egyptian working week — D47, PROPOSAL, the owner may change it); days and times in the viewer's zone; `?week=` normalized; the D30 teacher label.
- `lib/calendar/data.ts`: own sessions only (teacher / student / guardian per linked child); students and guardians see only their own roster entry; no Zoom field is selected.
- `WeekCalendar` server component: 7 columns on wide screens, stacked on phones; time, subject, teacher; the teacher sees the student (private) or "Group (n)" + names in `<details>`; cancelled/missed faded with their status. View-only; joining stays on My Sessions.
- Pages `/student/calendar`, `/teacher/calendar`, `/guardian/calendar` (one tab per child, the child's name on top); nav entry "Weekly Calendar".

## Log
- 2026-10-27: CAL-01..05 first (module missing) → green with the i18n + zone-form suites (13 tests); tsc + lint clean. 624bbae. Not checked in a browser (needs a login on the running dev server).
