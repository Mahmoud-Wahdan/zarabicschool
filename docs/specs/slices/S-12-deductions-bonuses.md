# S-12 — Deductions and bonuses (D14, D40)

> Plan row: `phase-09-plan.md` S-12. Skills: superpowers:test-driven-development, impeccable (detector), superpowers:verification-before-completion.

## Design (ee75a04)
- SQL S-5 (`20261028130000_payroll_adjustment_category`, FINANCIAL; owner approved as shown 2026-10-28; applied): `adjustment_category` BONUS|FINE|OVERTIME|OTHER, only on ADMIN_ADJUSTMENT; older rows NULL.
- Admin adjustments need a category and a reason. FINE < 0, BONUS/OVERTIME > 0, OTHER either sign. The teacher gets an in-app notice (`PAYROLL_ADJUSTMENT`, recorded SENT so it never goes to WhatsApp; ids only).
- `POST /api/payroll/adjustments/:id/reverse`: one opposite entry, same category (an older uncategorized row stays uncategorized); a deterministic key makes a second reversal 409.
- `GET /api/payroll/adjustments`: Admin filters (teacher, category, dates); a teacher sees only their own entries with the reason; approved-overtime rows (report_id) count as OVERTIME (D40); older manual rows show as "earlier entry (no category)".
- UI: category picker (the category gives the sign; only Other is typed with its sign), a filterable list with inline reverse; the teacher's payroll page shows the category.

## Log
- 2026-10-28: DB-01..06; affected suites 196/196 (payroll-money now sends category OTHER); detector clean.
