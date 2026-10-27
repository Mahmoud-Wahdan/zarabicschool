# S-11 — Teacher performance + Admin home (D7, D8)

> Plan row: `phase-09-plan.md` S-11. Skills: superpowers:test-driven-development, dataviz (palette validator, mark specs), superpowers:verification-before-completion.

## (a) Teacher indicators — D7 (136e63f)
- `lib/performance/teacher-indicators.ts`: per calendar month in the viewer's zone, held + ended sessions only. Late start = the teacher's FIRST platform join click > start + 5 min; no click counted apart (never guessed). Report on time = FIRST submission (`created_at` — `submitted_at` moves on a corrected resubmission) ≤ end + 15 min; one report expected per roster student. Monthly reports submitted. No combined score.
- `/teacher/indicators` (own data with the underlying rows, labelled "indicator"); `/admin/performance` (Admin only, every active teacher). Nav entries. Tests PF-01..05.

## (b) Admin home — D8 (8d8d1eb)
- Cards: active students, active teachers, sessions this week (Saturday-first, viewer zone, cancelled/missed excluded).
- Revenue: PAID invoices in EGP only (no dollar conversion) by the month paid in the viewer's zone; monthly (12), quarterly (4), half-year (4). Server-rendered SVG: ≤24px columns, 4px rounded top, hairline grid, compact ticks, one label on the tallest column, focusable `<title>` tooltip per column, table view. Single series → no legend box.
- Colour `--chart-revenue: #008f7f`: the validator FAILED the brand teal #006b5f (chroma floor) and PASSED #008f7f against #ffffff (the app has no dark mode). Admin only; the Supervisor home never loads money. Tests HM-01..04.
- Refunds (D19, S-13) are not built yet, so revenue is gross paid.

## Log
- 2026-10-27: PF and HM tests first (module missing) → green with the i18n + zone-form suites; tsc + lint clean. Not checked in a browser (needs a login on the running dev server).
