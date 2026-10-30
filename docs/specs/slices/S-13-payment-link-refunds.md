# S-13 — Payment link, provider void/refund, Admin partial refund (D6, D19, D20, D42, D43)

> Plan row: `phase-09-plan.md` S-13. Skills: superpowers:test-driven-development, impeccable (detector), superpowers:verification-before-completion.

## SQL S-6 (b6ed2db)
- `20261028140000_payment_audit_refunds` (FINANCIAL; owner approved as shown 2026-10-28; copied verbatim from the open-questions file; applied; `migrate diff` against the live DB is empty).

## (a) Payment link (b6ed2db)
- `POST /api/invoices/:id/send-link` (Admin): the payer only (linked guardian, or adult self-payer), a PENDING invoice, at most once in any **rolling 24 hours** (D81, owner 2026-10-29; built as a calendar day until then — fixed test-first, PL-07..09) and 3 per invoice; `LINK_SENT` audit; WhatsApp in the payer's language with the platform invoices link, never a Paymob URL, never an amount.

## (b) Provider void/refund (b6ed2db)
- A signed void/refund of a PAID invoice is audited as `VOIDED` / `PROVIDER_REFUND_SEEN` (was FAILED) and flags the Admin; no ledger change (D43). Our own Admin refunds will also show up this way when Paymob calls back.

## (c) Admin partial refund (32fbd33)
- Paymob Egypt docs: `POST /api/acceptance/void_refund/refund` with `auth_token`, `transaction_id`, `amount_cents`.
- Amount = floor(sessions × amount ÷ sessions bought) (D42). Limits: unreserved credit (balance − RESERVED − pending refunds) and paid − non-failed refunds.
- `invoice_refunds` PENDING + `REFUND_REQUESTED` under the invoice and package locks before the call; then once: SUCCEEDED → ledger `REFUND −n` + `REFUNDED`; FAILED → `REFUND_FAILED`; provider pending stays PENDING (Admin sees it). A balance below zero after the call (a session deducted in between) flags the Admin. Teacher pay untouched.
- `POST/GET /api/invoices/:id/refunds` (Admin; Idempotency-Key UUID required). UI: refund form with the same formula preview; one key per attempt.
- Not verified against real Paymob yet (no dashboard access): run one test-mode refund when the dashboard is back.

## Log
- 2026-10-28: PL-01..06, PR-01, RF-01..08, PS-14..15; money + security suites 246/246; detector clean.

- 2026-10-29: D81 — the one-per-day limit is now a rolling 24 h, checked under the invoice row lock (two concurrent sends queue one link). PL-07 (yesterday but < 24 h → 429) failed first, then green; PL-08 (> 24 h → 201), PL-09 (concurrent → one link). The job dedup key is the link number (1..3).
