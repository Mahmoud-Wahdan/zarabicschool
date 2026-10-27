# S-09 — Supervisor finance visibility (D11, D29)

> Plan row: `phase-09-plan.md` S-09. Decisions: D11, D29. Skills: superpowers:test-driven-development, superpowers:verification-before-completion.

## Design
- `lib/billing/student-finance-status.ts` (server-only): a separate read model returning, per student, only `remainingSessions` (ledger credit of the ACTIVE package(s) minus RESERVED reservations) and `paymentStatus` (latest invoice status PAID / PENDING / FAILED / CANCELLED, or null). Scoped to the caller's academy. No amount, currency or invoice id leaves it.
- `GET /api/admin/profiles?type=student` (Admin + Supervisor, unchanged guard) adds `financeStatus` to student rows only.
- Staff student list (`/admin/students`, shared by Admin and Supervisor): "Payment" badge (Paid / Pending / Failed / Cancelled / No invoice) and "Sessions left".
- `canActOnStudentFinance` unchanged: the Supervisor still cannot open, pay or change an invoice.

## Log
- 2026-10-27: SFV-01..05 first (suite failed: module missing). One fixture fix (a PAID invoice needs `paid_at`, DB CHECK). 6 suites / 35 tests green (incl. i18n keys, OWASP, phase-7 visibility, finance guard); tsc + lint clean. f7e5ffe. Not checked in a browser (needs a login on the running dev server).
