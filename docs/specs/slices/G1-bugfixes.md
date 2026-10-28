# G1 — Bug fixes A1–A7 (owner list, 2026-10-28)

> Skills: superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:verification-before-completion; impeccable (A4).

## A1 — Whitespace text node inside <tbody> (hydration error)
- Cause: `app/[locale]/admin/subjects/subjects-panel.tsx:50` had spaces after `{subjects.map(...)}` before `</tbody>`; JSX keeps same-line whitespace as a text node, which React rejects inside table markup.
- Fix: the spaces removed. A whole-app scan found no other hit.
- Guard: `__tests__/lib/table-whitespace.test.ts` parses every `app/**/*.tsx` with the TypeScript parser and fails on a kept whitespace child (text or `{" "}`) of table/thead/tbody/tfoot/tr; a self-test proves the scanner catches the pattern.
