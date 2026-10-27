# S-00 — In-flight work (return page + review fixes)

> Plan row: `phase-09-plan.md` S-00. Decisions: D19a, D23, D25. Skills: superpowers:test-driven-development, superpowers:verification-before-completion.

## Design
- **Return page** (D19a): `app/[locale]/payments/paymob/return/page.tsx` + `lib/payments/return-status.ts`. Reads only `order` (digits, ≤ 20) → `payment_attempts.provider_order_id`. Viewer must pass the checkout rule (`canActOnStudentFinance`, same academy). States from the DB: invoice PAID / CANCELLED / FAILED, else PENDING → DECLINED when a WEBHOOK `FAILED` audit row exists since the attempt started, otherwise PROCESSING. PROCESSING refreshes every 3 s, 20 times, then shows a "still processing" note. Signed-out or not-allowed viewers and unknown/garbled orders get one generic message.
- The other sub-slices follow the approved plans in `phase-09-plan.md` S-00 (c)–(k).

## Checklist
- [x] (a) commit review slices #1/#4/#5/#6 — f5ee13c
- [x] (b) return page + status display (RET-01..05)
- [ ] (c) #3 announcement scheduling
- [ ] (d) #8 origin checks
- [ ] (e) I-1 join link redirects + login callbackUrl (also wires "sign in and return" on the return page)
- [ ] (f) I-2 settlement fallback flags the Admin
- [ ] (g) I-3 opt-out drops shared numbers
- [ ] (h) M-1 `isUuidParam` on 8 routes
- [ ] (i) M-2 teacher host link (spec check first)
- [ ] (j) M-3 ngrok host from env
- [ ] (k) M-4 provider comment + "console" normalization

## Log
- 2026-10-27: (a) committed after re-running LS/AN/FLG/MR (3 suites, 13 tests green), tsc + lint clean.
- 2026-10-27: (b) RET-01..05 written first and failed (module missing), then green (5/5); tsc + lint clean. Fixture cleanup removes the append-only audit rows (`deleteAppendOnly`).
