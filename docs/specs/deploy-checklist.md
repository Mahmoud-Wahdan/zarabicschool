# Deploy checklist (production)

Started 2026-10-26 (Session 5). Extend it; never regenerate it. The launch gaps from the phase-06 gap analysis ("Launch gaps not in the docs") still apply and are referenced at the end.

## 1. Environment variables (host's environment settings, not a committed file)

- [ ] `NODE_ENV=production` (set by `next start` / the platform).
- [ ] `DATABASE_URL` (pooled) and `DIRECT_URL` (migrations only) point at the PRODUCTION database.
- [ ] `NEXTAUTH_URL` = the public site URL; `NEXTAUTH_SECRET` = a new random value (never the dev one).
- [ ] **`ALLOWED_ORIGINS`** — see §2. Without it every change request fails.
- [ ] `OPENWA_SEND_ALLOWLIST` **unset** (in non-production it restricts who receives WhatsApp; production must not carry it).
- [ ] `OPENWA_*`, `OPENWA_WEBHOOK_SECRET`, `PAYMOB_*`, `CLOUDINARY_*` set with production values.
- [ ] No `SEED_*` variables on the production host (the seed refuses production anyway).
- [ ] Secrets rotated before launch (action item from the 2026-10-25 secret scan).

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
