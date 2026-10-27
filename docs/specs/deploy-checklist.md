# Deploy checklist (production)

Started 2026-10-26 (Session 5). Extend it; never regenerate it. The launch gaps from the phase-06 gap analysis ("Launch gaps not in the docs") still apply and are referenced at the end.

## 1. Environment variables (host's environment settings, not a committed file)

- [ ] `NODE_ENV=production` (set by `next start` / the platform).
- [ ] `DATABASE_URL` (pooled) and `DIRECT_URL` (migrations only) point at the PRODUCTION database.
- [ ] `NEXTAUTH_URL` = the public site URL; `NEXTAUTH_SECRET` = a new random value (never the dev one). It is ALSO the base of the join links in WhatsApp messages (`lib/config/platform-url.ts`): a wrong value sends people to a wrong host; an empty one sends no link.
- [ ] **`ALLOWED_ORIGINS`** — see §2. Without it every change request fails.
- [ ] `MESSAGING_PROVIDER` **unset** (or `openwa`): `console`/`fake` make the production start FAIL on purpose (owner, 2026-10-27).
- [ ] `OPENWA_SEND_ALLOWLIST` **unset** (in non-production it restricts who receives WhatsApp; production must not carry it).
- [ ] `OPENWA_*`, `OPENWA_WEBHOOK_SECRET`, `PAYMOB_*`, `CLOUDINARY_*` set with production values.
- [ ] No `SEED_*` variables on the production host (the seed refuses production anyway).
- [ ] **LAUNCH BLOCKER — secrets rotated before launch** (action item from the 2026-10-25 secret scan; deferred to the deployment phase by the owner, 2026-10-27, decision D21 in `phase-09-decisions.md`): every secret in `.env` (DB, NextAuth, Paymob, OpenWA, Cloudinary) is rotated and the old values revoked.
- [ ] `APP_PUBLIC_URL` set to the public HTTPS origin (WhatsApp join links and the payment return page are built from it).

## 2. `ALLOWED_ORIGINS` (same-origin guard on every POST/PATCH/PUT/DELETE)

- **What it does:** `lib/request.ts` compares the browser's `Origin` header with this list, as an EXACT string match. Unknown, missing or empty → 403 `ORIGIN_NOT_ALLOWED` (fail closed). The two signed webhooks (Paymob, OpenWA) are exempt.
- **When it is read:** only when `NODE_ENV=production`. In development the Origin is compared with the Host header instead.
- **Format:**
  - A single origin, e.g. `https://zarabicschool.com`
  - or several separated by commas: `https://zarabicschool.com,https://www.zarabicschool.com` (spaces around commas are trimmed)
  - always the scheme (`https://`)
  - host only — no path and **no trailing slash** (`https://zarabicschool.com/` does NOT match)
  - `www` and non-`www` are different origins: list both if both are served (or redirect one to the other and list the final one)
  - a non-default port must be included (`https://example.com:8443`)
- **Where:** the hosting provider's environment variables for the production app. Then **restart / redeploy**, so the running process sees the new value.
- **How the failure looks:** pages load and login works, but every save, submit, approve or upload answers HTTP 403 with `{"error":{"code":"ORIGIN_NOT_ALLOWED"}}`.
- **How to fix:**
  1. Open DevTools → Network.
  2. Click the failing request → Request Headers → copy the `Origin` value.
  3. Add exactly that value to `ALLOWED_ORIGINS`.
  4. Redeploy and retry.

## 2b. Dependencies / install

- [ ] **npm install scripts:** during the 2026-10-26 upgrades npm SKIPPED the install scripts of `bcrypt` (native build), `prisma` (preinstall), `esbuild` (postinstall) and `unrs-resolver` (postinstall) — the dev machine kept its earlier builds, so nothing broke. A fresh install or a deploy build may need `npm install-scripts approve <pkg>` (or the platform's equivalent setting) for these packages, otherwise bcrypt has no native binary and login fails. Check: `node -e "require('bcrypt')"` succeeds, and `npx prisma generate` runs, on the build host.
- [ ] **`npm audit`:** after the 2026-10-26 upgrades one MODERATE finding remains — `fast-uri` (transitive, fix via `npm audit fix`). **Deferred to the final phase** (owner, 2026-10-26); re-run `npm audit` before launch.

## 3. Database

- [ ] `npx prisma migrate deploy` with `DIRECT_URL` (never `migrate reset` / `db push` on production).
- [ ] `npx prisma migrate status` = up to date; `prisma migrate diff` (DB → schema) = empty.
- [ ] Backups/PITR level confirmed; one restore drill done before real data.

## 4. Payments (Paymob)

- [ ] Sandbox run done (phase-06 A1 owner items a–f): callback envelope, HMAC field order, 3-DS pending→success sequence, void/refund shape.
- [ ] Processed-callback URL in the Paymob dashboard = **`https://<site>/api/payments/paymob/webhook`** (this exact path).
- [ ] The HMAC secret in the env matches the dashboard.

## 5. WhatsApp (OpenWA)

- [ ] OpenWA runs on an always-on host with a persistent session store; the production number is linked.
- [ ] Delivery webhook registered to `https://<site>/api/whatsapp/status` with `OPENWA_WEBHOOK_SECRET`.
- [ ] Live test done (it stays the LAST step).

## 6. Process model

- [ ] ONE long-running Node process runs the worker (`instrumentation.ts` starts it). It must not run on serverless functions, and must not run as two instances (double sends).

## 7. Launch gaps carried from the gap analysis (phase-06 § J)

Error monitoring/alerting; privacy/consent for minors + WhatsApp opt-in/opt-out; data retention; Admin view of FAILED WhatsApp jobs; encryption of application details, phones and Zoom links (owner, 2026-10-25).

## 8. Security headers (launch phase)

Already sent on every path (`next.config.ts`, 2026-10-26): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.

To add before launch, tested on the real host:
- [ ] **Content-Security-Policy** — start in `Content-Security-Policy-Report-Only` and fix the reports first. It must allow what the app really loads: Cloudinary (images/files), Paymob (checkout redirect/iframe if used), Google Fonts if still used, and Next.js inline scripts (nonce-based, see `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`; a nonce makes pages dynamic). Include `frame-ancestors 'none'` (it supersedes `X-Frame-Options`).
- [ ] **Strict-Transport-Security** — only once the site is HTTPS-only on every host and subdomain. Start with a short `max-age` (e.g. 300), then raise to `max-age=63072000; includeSubDomains`; add `preload` only after deciding on the preload list (hard to undo).
- [ ] **Permissions-Policy** — e.g. `camera=(), microphone=(), geolocation=(), browsing-topics=()` (Zoom runs in its own app/tab, not inside this site).
- [ ] `Cross-Origin-Opener-Policy: same-origin` — check that the Paymob flow still works.
- [ ] Verify with the browser DevTools (Network → Response Headers) and an external header scanner after deploy.
