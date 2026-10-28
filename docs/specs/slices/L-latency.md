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

## L2c — Independent page queries run together
- Measured (production, `scripts/perf/waves.mjs`, one load each): Admin home 34 queries in 4–7 waves; teacher home 18 queries in 9–11 waves; student home 17–18 in 6–7; guardian 13 in 4–6; Admin enrollments / invoices 19 in 2 (already fine). Average query ≈ 70 ms = the round trip to Supabase, so each wave the page waits for in sequence costs at least that.
- Fix (no change to what is read or returned): teacher home — join window, the teacher's day and the locale in one `Promise.all`, then the report statuses and the monthly-reminder reads together (both only need the teacher); student home — the finance flag, messages and the student's data together; Admin home — the cards, revenue, queue counts and today's sessions in ONE `Promise.all` (was two in a row).
- Per-request work already shared: `getAuthSession` is React-cached, so the root layout (badge count, A5) and the page's own auth check read the user once. The proxy reads only the JWT (no database).
- Not changed: authorization, security headers, ledger code; no index (no slow query found: every query cost the round trip, not scan time — see the L1 numbers).
- Test: `__tests__/lib/page-query-waves.test.ts` PW-01..03 keep the grouping.

## L2d — Badge count streamed (A5 follow-up found by the measurement)
- Measured after the first after-build: TTFB rose from ~25 ms to ~320–390 ms on every page, because the root layout awaited the user read and the badge count before streaming anything (the loading skeleton came later; total load unchanged).
- Fix: the layout reads only the session cookie (`getSessionUserId`, no database) and passes the count as a promise; the bell reads it with `use()` inside its own Suspense boundary (fallback: the bell without a number); the inbox uses `useBadgeActions()` (never suspends). Still no client request for the first count: it arrives in the same HTML stream.
- Measured after: TTFB 21–35 ms again; badge requests 0 per load and 0 over 6 navigations, in production and in dev.
- Tests: BP-10 a streamed count shows when it resolves, no request; BP-11 a failed (null) count asks once; BP-09 the layout does not await the count.

## L1 / L3 / L4 — Measurements, tunnel guide, before/after
- Tools committed in `webapp/scripts/perf/` (fixture in a per-run test academy, query-count preload without SQL or data, worker off and OpenWA unreachable during a production measurement). Guide and full before/after table: `docs/specs/dev-tunnel.md`.
- Where the slowness is: (1) the owner's PC moves local TCP at ~115–145 KB/s (plain Node from memory: 4 MB in 27–30 s); every file and every tunnel response passes through it. (2) The ngrok free tunnel adds ~130 ms per request, and under parallel load its edge answers 5xx or drops the TLS handshake (dev: 17–29 of ~35 files failed; production: 1 of 3 fresh loads had 10 failures). (3) Dev mode serves many unbundled files and must not be used through the tunnel. (4) The app itself: warm production pages take 0.4–0.9 s locally, mostly database round trips (~70 ms each to Supabase).
- Honest split: on a warm production page through the tunnel the app is ~0.4–0.9 s and the tunnel adds ~0.15 s per request. The big waits the owner saw (tens of seconds) came from the PC's local network speed carrying the 3.9 MB icon font and dev mode's files, and from ngrok dropping requests. After the fixes a first visit through the tunnel takes 8–10 s instead of 30–52 s; most of the rest is still the PC and the tunnel, not the app.
- No index proposal: no slow query was found (each query costs the round trip, not scan time).
- Seed academy untouched; the measurement fixture is removed at the end (Z1).
