# Dev tunnel (ngrok) and how to measure speed

> L3 (owner list, 2026-10-28). No secret, token or tunnel address in this file; the
> tunnel address lives only in `webapp/.env` as `APP_PUBLIC_URL`.

## When to use ngrok

- **Only for tests that need a public URL**: Paymob webhooks (test mode) and OpenWA/WhatsApp webhooks.
- **Everything else: browse `http://localhost:3000`.** The tunnel adds about 130 ms to every request and, on the free plan, drops requests under load (see the numbers below).
- **Never browse `next dev` through the tunnel.** Dev mode serves ~35 separate files per page; through the free tunnel 17–29 of them failed (5xx from the ngrok edge) and the page never started.

## Realistic test from another device (production build behind ngrok)

From `webapp/`:

```sh
npm run build
npm run start          # serves on port 3000 (the port the tunnel forwards to)
ngrok http 3000        # in another terminal; APP_PUBLIC_URL must match the tunnel address
```

Notes:
- A production start refuses `MESSAGING_PROVIDER=console|fake` (`instrumentation.ts`). It uses OpenWA, and the worker **can send real WhatsApp messages**. Use it on purpose only.
- For a measurement that must never send anything, use `sh scripts/perf/serve.sh start <query-log-file>`. It turns the worker off and points OpenWA at a closed local port for that process only; `.env` is not changed.
- The free plan shows a warning page to browsers on the first visit; click through once. Scripts send a custom User-Agent instead. An extra `ngrok-skip-browser-warning` header breaks script loading: the page's script chunks load in CORS mode, and the app does not answer the preflight.
- Each new browser profile must download the app's files once (about 200 KiB for the login page). After that they come from the cache (`Cache-Control: public, max-age=31536000, immutable`, gzip).

## Reading the ngrok inspector

- Open `http://127.0.0.1:4040` while ngrok runs.
- Each request shows its status and duration. You can replay a webhook from there, for example a Paymob callback.
- **5xx answers that never reach the app** (nothing in the server log) come from the ngrok edge, not from Zarabicschool.
- `http://127.0.0.1:4040/api/status` shows the region and latency. It was `eu`, about 60 ms, during these measurements.

## The PC itself

Local TCP on the owner's PC runs at **about 115–145 KB/s, even for plain Node serving bytes from memory**: 4 MB took 27–30 s over localhost and over the LAN address, with 1 or 4 parallel connections. A normal PC does hundreds of MB/s.

Something on the machine shapes local traffic: a network filter, VPN or antivirus web protection. Defender is the only antivirus listed. The ngrok agent reads from localhost too, so this slows every tunnel response as well.

Check it with the app running on port 3000:

```sh
curl -s -o NUL -w "%{size_download} bytes in %{time_total} s\n" http://localhost:3000/_next/static/chunks/<any big chunk>.js
```

Anything above about 0.1 s for 1 MB means the machine is throttling.

## How to measure (scripts in `webapp/scripts/perf/`)

| Script | What it does |
|---|---|
| `fixture.ts` | Creates or removes one per-run test academy with every role (never the seed academy): `npx tsx --require ./scripts/perf/server-only-shim.cjs scripts/perf/fixture.ts create\|cleanup`, with `PERF_FIXTURE=<file>`. |
| `serve.sh <dev\|start> <log>` | Starts the app on port 3000 with `preload.cjs`. It logs each database query's time and duration (no SQL, no data) and turns the worker off. |
| `measure.mjs <base> <label> [runs]` | Per page: TTFB, load, query count and summed query time, badge requests, app requests (the ones counted against the 120/min/IP limit). Also badge requests over 6 sidebar clicks. Reuses one login per role (the login limit is 5 per 10 min). |
| `waves.mjs <base> <ROLE> <path>` | Groups one page load's queries into waves: queries the page waits for one after another. Each wave costs at least one round trip to Supabase (~70 ms). |
| `assets.mjs <base> [path] [runs]` | Fresh browser: files, failures, 5xx, bytes, load time, whether the page started (hydrated). |

## Measured numbers (2026-10-28, test academy, production build unless noted)

| Page | App time before (TTFB / load) | After | Queries before → after | Waves before → after | App requests per load before → after | Tunnel before | Tunnel after |
|---|---|---|---|---|---|---|---|
| Login, fresh browser (all files) | 25–27 s, 4.1 MB | **3.8–4.7 s, 200 KiB** | — | — | — | 30–52 s (1 of 3 did not start) | **8–10 s** (1 of 3 had 10 edge 5xx) |
| Admin home, first visit | 23 ms / 22.6 s | 31–199 ms / **3.8 s** | 37 → 33 | 4–7 → 5 | 29 → 10 | first load 34.6 s | **6.0 s** |
| Admin home, warm | 23 ms / 618 ms | 31 ms / 710 ms | 37 → 33 | | 29 → 10 | 157 ms / 752 ms | 178 ms / 815 ms |
| Admin sessions | 35 ms / 632 ms | 33 ms / 560 ms | 50 → 46 | | 28 → 5 | 175 ms / 650 ms | 165 ms / 665 ms |
| Admin enrollments | 38 ms / 353 ms | 33 ms / 373 ms | 23 → 19 | 2 → 2 | 26 → 1 | (tunnel timed out) | 155 ms / 500 ms |
| Admin invoices | 30 ms / 329 ms | 25 ms / 359 ms | 23 → 19 | 2 → 2 | 28 → 1 | (tunnel timed out) | 148 ms / 483 ms |
| Teacher home | 27 ms / 1 670 ms | 21 ms / 877 ms | 20 → 18 | 9–11 → 9 | 18 → 5 | — | 158 ms / 1 030 ms |
| Student home | 31 ms / 595 ms | 35 ms / 680 ms | 19 → 17 | 6–7 → 4–5 | 16 → 3 | — | 164 ms / 732 ms |
| Guardian home | 29 ms / 594 ms | 26 ms / 629 ms | 15 → 13 | 4–6 → 5–6 | 16 → 3 | — | (login through the tunnel timed out) |
| Badge requests per page load | dev 2, prod 1 | **0** | | | | | |
| Badge requests over 6 sidebar clicks | dev 10, prod 5 | **0** | | | | | |

### Reading the table

- **Warm pages are already fast in production:** under 1 s locally, plus about 130 ms TTFB per request through the tunnel. The app's own server time is mostly database round trips (about 70 ms each to Supabase).
- **The big waits were first visits and dev mode.** The 3.9 MB icon font (now removed) passed through this PC's ~115 KB/s local link, and so did dev mode's many unbundled files.
- **Dev versus production through the tunnel:** dev did not even start (17–29 files failed); production loads in 8–10 s on a first visit and well under a second warm.
- **About the TTFB column:** a short TTFB only means the shell and loading skeleton arrive quickly; the "load" column is when the page is complete. The first after-build (badge count awaited in the layout) raised TTFB to about 320–390 ms. The final build streams the count instead, which brought TTFB back to 21–35 ms.
