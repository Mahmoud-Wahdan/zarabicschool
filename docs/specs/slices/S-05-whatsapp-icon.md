# S-05 — WhatsApp icon next to phone numbers

> Plan row: `phase-09-plan.md` S-05. Decision: D17. Skills: superpowers:test-driven-development, modern-web-guidance (guide `icons`), superpowers:verification-before-completion.

## Design
- `app/_components/ui/whatsapp-phone-link.tsx`: shows the number (`<bdi dir="ltr">`, correct in RTL) + a `https://wa.me/<digits>` link from the shared `toWaMeLink` (Egyptian local → 20…, `+`/`00` kept, anything else → no link). `target="_blank"`, `rel="noopener noreferrer"`, decorative icon (`aria-hidden`) + `aria-label`/`title` "Chat with {name} on WhatsApp". No logging, no MessagingProvider.
- Placement: the staff lists `/admin/students`, `/admin/teachers`, `/admin/guardians` (shared `profiles-panel.tsx`, Admin + Supervisor pages) get a "Phone" column. The profiles API already returned `phone` to Admin/Supervisor only; no API change. Before this slice no staff list displayed phone numbers at all, so the column is new.

## Log
- 2026-10-27: WAI-01..05 first (suite failed: module missing); WAI-04 was too broad (matched the word OpenWA in a comment) → it now strips comments. 2 suites / 16 tests green (incl. OWASP); tsc + lint clean. Commit see `git log` (feat(people) … S-05).
