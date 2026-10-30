# Dev tunnel (Cloudflare Tunnel) and how to measure speed

> L3 (owner list, 2026-10-28); tunnel changed 2026-10-29; D73 confirmed 2026-10-29. No secret, token or tunnel
> address in this file; the tunnel address lives only in `webapp/.env` as `APP_PUBLIC_URL`.

## Rule (D73, confirmed by the owner 2026-10-29)

**A tunnel is used ONLY for Paymob webhook tests. Everything else runs on `http://localhost:3000`.**

- **Paymob test mode:** Paymob's servers must reach the transaction-processed callback
  (`/api/payments/paymob/webhook`) and the subscription callback
  (`/api/payments/paymob/subscription-webhook`). Only these need a public URL.
- **Paymob return page:** it is a browser redirect, so it can stay on localhost
  (`http://localhost:3000/ar/payments/paymob/return`, D23). No tunnel is needed for it.
- **OpenWA does not need a tunnel.** It runs on the same PC: register its webhook with
  `http://localhost:3000/api/whatsapp/status` and add `SSRF_ALLOWED_HOSTS=localhost,127.0.0.1`
  to `OpenWA/.env` (OpenWA refuses private addresses otherwise). The owner tested a real number
  through OpenWA on 2026-10-29 and it works (D79).
- **Daily browsing, UI checks, a phone:** localhost. Never browse `next dev` through a tunnel.
  Dev mode serves ~35 separate files per page and is slow on this PC (see "The PC itself").
- Stop the tunnel as soon as the webhook test is done. It exposes the dev machine and the dev database.

## Which tunnel the docs recommend: Cloudflare Tunnel (ngrok stays a fallback)

**Recommended: Cloudflare Tunnel (`cloudflared`), named tunnel when you have a domain on Cloudflare.**

Why:

1. **Stable address.** A named tunnel keeps the same hostname. Paymob's callback URLs are set
   once in the dashboard and never change between test sessions.
2. **No browser warning page.** ngrok's free plan shows an interstitial, and the header that
   skips it broke script loading in the 2026-10-28 measurements.
3. **ngrok's free edge failed under load** on 2026-10-28: 5xx answers and dropped TLS handshakes.

This matters little for webhooks, which are a few small requests, but it is the measured
difference. **Not measured yet** for Cloudflare: the cloud session that made the switch could
not reach Cloudflare. ngrok works the same way (`ngrok http 3000`, with its free static domain
for a stable address). Use it if `cloudflared` is not an option; every step in
"After the tunnel starts" applies to both.

## Option A — quick tunnel (no account, new address every start)

```sh
winget install --id Cloudflare.cloudflared      # once (Windows); or download cloudflared from Cloudflare
cd webapp
npm run build
npm run start                                   # serves on port 3000
cloudflared tunnel --url http://localhost:3000  # other terminal; prints https://<random>.trycloudflare.com
```

The address changes every time `cloudflared` restarts, so Paymob's callback URL has to be
changed in the Paymob dashboard each time. Fine for one test session.

## Option B — named tunnel (stable address; best for Paymob)

Needs a free Cloudflare account and a domain whose DNS is on Cloudflare.

```sh
cloudflared tunnel login                                  # once: browser sign-in, stores a cert locally
cloudflared tunnel create zarabic-dev                     # once: creates the tunnel + credentials file
cloudflared tunnel route dns zarabic-dev dev.<your-domain>  # once: DNS record for the hostname
cloudflared tunnel --url http://localhost:3000 run zarabic-dev   # every time
```

The credentials file and the cert stay on the PC (`%USERPROFILE%\.cloudflared\`); never commit them.

## After the tunnel starts (any tunnel)

1. `webapp/.env` stays as it is: `APP_PUBLIC_URL=http://localhost:3000`. The webhooks are signed
   server-to-server calls. They need no `ALLOWED_ORIGINS` entry and no public `APP_PUBLIC_URL`,
   because nobody browses through the tunnel (D73).
2. Start the app as usual. `npm run dev` is fine for a webhook-only test, because the tunnel
   carries only Paymob's few POSTs, not pages.
3. Pay from the browser on `http://localhost:3000`.
4. Paymob dashboard (test mode): processed callback `https://<tunnel host>/api/payments/paymob/webhook`
   (and the subscription callback `https://<tunnel host>/api/payments/paymob/subscription-webhook`);
   the response callback stays `http://localhost:3000/ar/payments/paymob/return` (D23).
5. Stop the tunnel when the test is done — it exposes the dev machine and the dev database.

Notes:
- A production start refuses `MESSAGING_PROVIDER=console|fake` (`instrumentation.ts`). It uses
  OpenWA, and the worker **can send real WhatsApp messages** (the dev allowlist does not apply in
  production). Use it on purpose only.
- For a measurement that must never send anything, use `sh scripts/perf/serve.sh start <query-log-file>`.
  It turns the worker off and points OpenWA at a closed local port for that process only; `.env` is not changed.
- **Rate limits behind a tunnel (G-A07-5, fixed 2026-10-29):** the app reads the client address
  `TRUSTED_PROXY_HOPS` entries from the right of `X-Forwarded-For` (default 1, the address the
  tunnel/proxy added). Entries a client sends itself on the left never choose a rate-limit bucket.
  Set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the app (deploy checklist §1).
- Each new browser profile must download the app's files once (about 200 KiB for the login page).
  After that they come from the cache (`Cache-Control: public, max-age=31536000, immutable`, gzip).

## Seeing what the tunnel does

- `cloudflared tunnel --loglevel debug ...` prints every request with its status.
- `cloudflared tunnel --metrics localhost:2000 ...` exposes counters at `http://localhost:2000/metrics`
  (requests, errors, response times).
- **5xx answers that never reach the app** (nothing in the server log) come from the tunnel's edge,
  not from Zarabicschool. (ngrok: the inspector at `http://127.0.0.1:4040` shows the same and can
  replay a webhook.)

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

## Measured numbers (2026-10-28, ngrok free plan, test academy, production build unless noted)

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
