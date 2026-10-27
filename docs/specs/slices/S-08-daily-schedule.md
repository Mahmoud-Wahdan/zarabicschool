# S-08 — Daily teacher WhatsApp schedule (D5, wording D31)

> Plan row: `phase-09-plan.md` S-08. Skills: superpowers:test-driven-development, superpowers:verification-before-completion.

## Design (df54860)
- `lib/notifications/daily-schedule.ts`. Worker step `planDailySchedules`: one `DAILY_SCHEDULE` job per active teacher with a session on their current local date, planned any tick from 00:00 to before 08:00 local; dedup per teacher + date; payload `{ localDate }` only. A teacher with no session that day gets nothing.
- Text composed at send time: D31 Arabic wording (English mirrors it), one line per session, group = "مجموعة (n طلاب)", make-ups (replacement sessions) under "حصص التعويض:" with their own numbering, cancelled/missed left out, no links.
- A job picked up at or after 08:00 local is CANCELLED (never sent); later changes show in-app (teacher "Today" list).
- Tests DS-01..07; worker, WhatsApp, announcements, join-window, sessions and i18n suites: 84/84 green.
