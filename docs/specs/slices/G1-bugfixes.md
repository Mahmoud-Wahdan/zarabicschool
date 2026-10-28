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

## A4 — Unreadable text on the dark navy fill (contrast)
- Root cause (not a token value): `a { color: inherit }` and the other element rules in `app/globals.css` were outside any cascade layer. Tailwind v4 puts utilities in `@layer utilities`; an unlayered rule beats every layered one, so on every link styled as a tab/chip/button (`<Link className="bg-primary text-on-primary">`, e.g. the selected Monthly / Quarterly / Half-year tab) the white text lost to the inherited dark body colour. Same for heading fonts set by utilities.
- Fix (base level, no restyling): body, headings, `*`, `a`, form controls and the global `:focus-visible` outline moved into `@layer base`.
- Token audit (WCAG AA 4.5:1 for text), changed at the token only: `--outline` #74777f → #64676f (placeholder/caption text on light surfaces was 3.66–4.48), `--emerald` #00897b → #00796b (text on white and white on emerald was 4.32), `--success` #059669 → #047857 (badge text 3.58), `--danger` #dc2626 → #b91c1c (4.41). One class-list fix: the landing step-4 circle used `text-on-tertiary` (white) on `bg-tertiary-container` (gold), 2.31 → its own pair `text-on-tertiary-container`.
- Side effect handled: with `:focus-visible` layered, `outline-none` really removes the outline; the reports-queue search input had only `outline-none`, so it was removed there (the input keeps the global focus outline it had before).
- Guard: `__tests__/lib/contrast-tokens.test.ts` — CT-01 no unlayered element rule; CT-02 34 designed text/background token pairs ≥ 4.5:1; CT-03 every class list in app/ that sets a token background and text colour (including hover/aria/placeholder variants) ≥ 4.5:1; CT-04 no `outline-none` without its own focus style.
- Impeccable detector: clean on globals.css, revenue-chart, how-to-start, reports-queue-panel. Not changed: layouts, sizes, the Stitch look (S-14).
