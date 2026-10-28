# G1 — Bug fixes A1–A7 (owner list, 2026-10-28)

> Skills: superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:verification-before-completion; impeccable (A4).

## A1 — Whitespace text node inside <tbody> (hydration error)
- Cause: `app/[locale]/admin/subjects/subjects-panel.tsx:50` had spaces after `{subjects.map(...)}` before `</tbody>`; JSX keeps same-line whitespace as a text node, which React rejects inside table markup.
- Fix: the spaces removed. A whole-app scan found no other hit.
- Guard: `__tests__/lib/table-whitespace.test.ts` parses every `app/**/*.tsx` with the TypeScript parser and fails on a kept whitespace child (text or `{" "}`) of table/thead/tbody/tfoot/tr; a self-test proves the scanner catches the pattern.

## A2 — MISSING_MESSAGE paymentAudit.events.PROVIDER_REFUND_SEEN
- Cause: SQL S-6 added five event types (LINK_SENT, REFUND_REQUESTED, REFUND_FAILED, VOIDED, PROVIDER_REFUND_SEEN) to the TypeScript union; the Admin payment-audit page reads `t(`events.${row.eventType}`)` and had only the six older texts. The key test covered literal keys only.
- Fix: one source of truth `lib/payments/audit-events.ts` (`PAYMENT_AUDIT_EVENT_TYPES`); the audit writer type and the Admin filter/tones derive from it; ar + en text for all 11 events (the filter now offers the new ones too).
- Guard: `__tests__/i18n/dynamic-keys.test.ts`. DYN-01 every template-literal t() call in app/ and lib/ (56 templates) must be registered with its value source (Prisma enum, TS union, const list); DYN-02 no stale entry; DYN-03 every value is a STRING message in en and ar (t.raw lists: an array of strings); DYN-04 the event list equals the DB CHECK in the latest migration. All other dynamic keys already resolved; two calls guarded by t.has() with a fallback (attendanceResolution.blocked, inbox.kind) are registered as guarded.

## A3 — INSUFFICIENT_PATH in attendance page titles
- Cause: `generateMetadata` of the student, guardian AND teacher attendance pages called `t("student")` / `t("guardian")` / `t("teacher")`; those are objects (title, subtitle, ...), not strings.
- Fix: `t("<role>.title")` on all three pages.
- Guard: `message-keys.test.ts` I18N-03 now requires every literal key to reach a STRING in both locales (only `t.raw()` may reach a list or object); dynamic keys are held to the same rule by DYN-03 (A2). The whole app was scanned: these three were the only hits.
