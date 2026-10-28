# L — Latency (owner list, 2026-10-28)

> Skills: superpowers:systematic-debugging (measure first), superpowers:test-driven-development, superpowers:verification-before-completion; impeccable (detector). Measurement tools: `webapp/scripts/perf/` (see `docs/specs/dev-tunnel.md`).

## L2a — Icon font replaced by bundled SVG icons (owner choice)
- Measured: `material-symbols-outlined.woff2` = 3.9 MB, the largest download by far (all JS for the login page is ~240 KiB compressed). A first visit on a device needs it: 24–35 s on the owner's PC (see L1, the PC's local network speed), 30–52 s through the tunnel.
- Owner (2026-10-28): remove the Material Symbols font; use a lighter library that is not downloaded from outside. Done with `lucide-react` (already a dependency): SVG components compiled into the app bundle; only the ~107 icons the app uses ship. `material-symbols` uninstalled; the font CSS import and the font rules removed.
- `app/_components/ui/icon.tsx` keeps the Material names the pages use and maps them to Lucide icons; `IconName` makes TypeScript reject an unmapped name (nav items, cards, empty states, metric tiles, badges and the inbox table are typed); names that come from data (a subject's icon) go through `iconOr(value, fallback)`. The 28 direct icon-font spans (login, change password, shell, join link, inbox, payment return, site header) now use `<Icon>`; the text-size class became the `size` prop.
- Visual: icon shapes change from Material to Lucide (same meaning, line style). No layout change. Stitch (S-14) can pick the final icon set later.
- Tests: `__tests__/lib/icons.test.tsx` IC-01 every mapped name renders an aria-hidden SVG; IC-02 no `material-symbols` in the app or package.json; IC-03 data names fall back safely.

## L2b — Sidebar prefetch off (owner choice)
- Measured (production, before): every page load prefetched the whole sidebar: 29 extra requests per Admin page, 21 per teacher page (only ~2 KiB in total, but each one is a request through the proxy). The proxy's rate limit is 120 requests/min per IP (security; not changed), so an Admin opening 4–5 pages a minute got 429 pages; the measurement script hit it three times.
- Fix: `prefetch={false}` on every Link of the dashboard shell (sidebar and mobile drawer items, the bell, the account link). A click now fetches the page once; the page's loading skeleton shows after one server round trip instead of instantly.
- Test: `__tests__/lib/shell-prefetch.test.ts` SP-01 every `<Link>` in the shell has `prefetch={false}` (TypeScript parser).
