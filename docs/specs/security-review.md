# Security review — OWASP Top 10:2025 mapping (Session 5, 2026-10-26)

**Scope:** `webapp/` at the end of Session 5 (uncommitted work included). **Method:**
- code reading and greps;
- two route sweeps (role guard and same-origin);
- three independent code-review passes (A1; A2/A3/A5; Phase 7 + lateness);
- `npm audit` (report only).

**Not done:** no penetration test, no dynamic scanning, no test run (tests are deferred to the final phase). This document does **not** claim the app is secure. It lists what was verified, how, and the known gaps.

**Edition:** OWASP Top 10:2025 (8th edition) — A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging & Alerting Failures, A10 Mishandling of Exceptional Conditions (SSRF is folded into A01). Source: https://owasp.org/Top10/2025/0x00_2025-Introduction/

Legend: **Fixed** = changed this session · **Verified** = checked, nothing to change · **Gap** = known, not fixed (risk + owner action).

---

## A01 — Broken Access Control (incl. SSRF)

**What protects it**
- **Routing:** `proxy.ts` gates pages by role prefix (/admin, /supervisor, /teacher, /student, /guardian) with an explicit ADMIN+SUPERVISOR list for shared operator pages.
- **Pages** re-check with `requireRole(s)`.
- **APIs** use `requireApiRole(s)` (session-based, NextAuth JWT).
- **Tenancy:** every query is scoped by `academyId`.
- **Finance wall:** one rule (`lib/guards/finance-access.ts`).
- **Report visibility:** a single data entry point (`lib/reports/visibility.ts`, `lib/reports/monthly.ts`) returning null → 404 for unauthorized viewers (no existence leak).

**Evidence (how verified)**
- **Route sweep (2026-10-26):** 63 route files under `app/api`. 59 call `requireApiRole(s)`. The 4 without are:
  - NextAuth's own handler;
  - `auth/change-password` (authenticates with `getAuthSession()`);
  - the two signed webhooks (Paymob, OpenWA — HMAC instead of a session).
- **B2 — Fixed** — a real IDOR. `?type=constructor` on `/api/admin/profiles` resolved to Object's constructor, the role filter vanished, and a Supervisor received every user of the academy (incl. Admins, phones, emails). Now `z.enum`.
- **Complaints visibility (owner rule): Verified by construction.**
  - The only read paths are `/admin/complaints` and `/admin/complaints/:id`. They are ADMIN/SUPERVISOR in the proxy and the page, and academy-scoped.
  - POST returns `{received:true}` only. Filing and resolving create no notification job. No search or count is exposed to other roles.
  - A grep for "complaint" in `app/` and `lib/` finds only Phase 7 files.
  - Filers must be session participants (404 otherwise).
  - Students and guardians may only name the teacher (minors' data).
  - Independent review confirmed.
- **Report / monthly report / evaluation visibility: Verified.**
  - Report visibility is submit-time per CONTEXT §9: the guardian sees the whole report; a student with a guardian sees homework, notes and attachments; an adult student sees the whole report — in every status.
  - Evaluations are readable by Admin/Supervisor only. Teachers have no route; the summaries page is ADMIN/SUPERVISOR.
- **Click timeline: Verified.** The data layer itself returns nothing for non-operators (`lib/sessions/click-timeline.ts`). It holds no link.
- **Signed file links: Verified.**
  - The attachment download route authorizes through `getReportForViewer` before issuing a Cloudinary private Download API URL with `expires_at` (≤ 3600 s, clamped).
  - Assets are private ("authenticated"); uploads are signed server-side only.
- **Finance wall: Fixed (B5).** One strict rule: adult AND no guardian. A student with a guardian gets 403/404 on invoice APIs and pages.
- **Supervisor money boundary: Verified.** Payroll, overtime and payment routes are ADMIN-only; the session-detail page omits money fields for SUPERVISOR server-side.
- **Proxy fix (Phase 7): Fixed.** Supervisors were redirected away from the new complaints, evaluations and announcements pages; the paths were added to the ADMIN+SUPERVISOR list.
- **SSRF: Verified.** No server-side fetch takes a user-supplied URL. Outbound calls go to fixed env hosts (Paymob, OpenWA, Cloudinary). Zoom links are only redirected to (after `validateZoomUrl`, https-only DB CHECK), never fetched.

**Gaps**
- **G-A01-1 (Medium):** an Admin can create a MINOR student without a guardian (`POST /api/admin/profiles?type=student`, `isAdult` default false, `guardianId` optional; the profile PATCH can unlink). The owner states none exist. Reported, not changed.
- **G-A01-2 (Low):** `GET /api/sessions/:id/join` performs a write (click log) on GET. It is a click log only and rate-limited, but a cross-site GET can create a log row for a logged-in user (it also redirects to Zoom). This weakens the click evidence.

## A02 — Security Misconfiguration

**What protects it / evidence**
- **Same-origin guard (B3): Fixed.** `requireSameOrigin` is the first statement of every POST/PATCH/PUT/DELETE under `app/api` (static sweep: only the two signed webhooks are exempt). Production compares `Origin` with `ALLOWED_ORIGINS` (exact match, fail closed). Documented in `.env.example` and `deploy-checklist.md` §2.
- **Dev-only guards: Verified.** `OPENWA_SEND_ALLOWLIST` only applies outside production; the deploy checklist requires it unset in production.
- **Seed: Verified.** `seed-demo.ts` refuses production and non-empty databases; passwords come from env.

**Gaps**
- **G-A02-1 (Medium → partly fixed 2026-10-26):** `next.config.ts` now sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `X-Frame-Options: DENY` on every path. Still missing (launch phase, `deploy-checklist.md` §8): CSP, HSTS, `Permissions-Policy`. Original finding: no security headers were configured (`next.config.ts` has no `headers()`): no CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, HSTS. Recommendation: add a conservative header set before launch (decide on CSP with the Cloudinary/Zoom/Paymob origins).
- **G-A02-2 (Medium):** `ALLOWED_ORIGINS` missing or wrong in production = every mutation fails (fail closed — an availability risk, not an exposure). Mitigated by the checklist.
- **G-A02-3 (Low):** `auth/change-password` additionally requires `Origin === new URL(request.url).origin`. Behind a reverse proxy, `request.url` may carry the internal host, so password changes could fail in production. Verify on the real host; the generic `requireSameOrigin` already covers CSRF.
- **G-A02-4 (Info):** `next.config.ts` sets `allowedDevOrigins: ["192.168.1.41"]` (dev only).

## A03 — Software Supply Chain Failures

**Update 2026-10-26 (owner follow-up 2):** after the upgrades `npm audit` reports **1 moderate** only (`fast-uri` 3.0.0–3.1.8, transitive; fix via `npm audit fix`, not run). The critical/high findings below are resolved.

**`npm audit` (2026-10-26, report only — nothing upgraded)**

| Package | Kind | Severity | Advisories (summary) | Fixed in |
|---|---|---|---|---|
| `next` 16.3.7 | direct | **critical** | 2× unauthenticated RCE (Image Optimization with SVG; `use cache` typed arrays), SSRF in Image Optimization, Server Actions DoS, cache poisoning (SSG/ISR), info disclosure (metadata image routes, dev MCP endpoint) | 16.4.3 |
| `prisma` 7.10.0 / `@prisma/config` / `deepmerge-ts` / `mysql2` | direct + transitive | high | deepmerge-ts stack exhaustion; mysql2 auth-plugin downgrade + zlib inflate (mysql2 is not used here — PostgreSQL) | prisma 7.10.1 |
| `zod` ^4.6.5 | direct | high | memory exhaustion on oversized constrained collections | 4.6.6 |
| `fast-uri` | transitive | moderate | scheme spoofing / host confusion | 3.1.9 |

- **G-A03-1 (High — owner action):** upgrade `next` to ≥ 16.4.3 before any public deployment. Some advisories may not apply here (this app does not use `use cache` or SVG image optimization — not verified exhaustively), but RCE-class advisories justify the upgrade regardless.
- **G-A03-2 (Medium):** upgrade `prisma`/`@prisma/client` to 7.10.1 and `zod` to ≥ 4.6.6; run `npm audit fix` for `fast-uri`.
- Upgrades are dependency changes and need the owner's OK; not done in this session.
- Lockfile present (`package-lock.json`); `npm ci` recommended in CI/deploy.

## A04 — Cryptographic Failures

**Evidence**
- **Passwords: Verified.** bcrypt (cost 12) in `users.password_hash`. The OpenWA API key lives only in env, never in the DB.
- **Sessions: Verified.** NextAuth JWT signed with `NEXTAUTH_SECRET`, 8 h maxAge.
- **Webhooks: Verified.**
  - Paymob: HMAC-SHA512 over the documented field list, `timingSafeEqual`, checked FIRST.
  - OpenWA: HMAC-SHA256 over the raw body (`X-OpenWA-Signature`), `timingSafeEqual`, 401 when the secret is missing.
- **Files: Verified.** Private Cloudinary assets with short-lived signed URLs.

**Gaps**
- **G-A04-1 (Medium, owner-accepted for MVP):** application details, phones and Zoom links are stored in plaintext. "Encryption of application details, phones and Zoom links" is on the launch list (owner, 2026-10-25).
- **G-A04-2 (Info):** TLS/HSTS depends on the hosting setup (deploy checklist).

## A05 — Injection

**Evidence: Verified (grep).**
- All DB access goes through Prisma. Raw SQL uses tagged `$queryRaw` with bound parameters (settlement locks, delivery counts, evaluation aggregates).
- `$queryRawUnsafe` is used only with constant SQL (readiness probes) or positional parameters (badge count).
- Zod validates every mutating route body.
- React escapes output. A grep of `app/` and `lib/` finds no `dangerouslySetInnerHTML` anywhere.
- WhatsApp templates interpolate DB values into plain text only.

**Gap**
- **G-A05-1 (Low):** announcement and admin-message text is sent verbatim to WhatsApp. It is authored by operators only — an accepted design, noted.

## A06 — Insecure Design

**Evidence**
- **Payments (A1): Fixed.**
  - The invoice is matched only by the HMAC-covered Paymob order id, never `merchant_order_id`.
  - Exact amount/currency/provider check.
  - The success predicate excludes pending/voided/refunded/uncaptured.
  - Idempotent event claims, with UNMATCHED stored under a separate key.
  - Every signed callback gets 200 plus a status.
  - Anomalies give an audit row + Admin flag, no money.
  - Annual plans are refused everywhere (A4).
- **Settlement:**
  - A2: CANCELLED/MISSED sessions are never settled, and a session with a settled report cannot be cancelled or marked MISSED (lock order unified).
  - A3: overtime claim + ledger in one transaction, one entry per report (DB).
  - A5: payroll idempotency keys, currency per teacher; P8/P9 fixed.
- **Append-only:** `subscription_ledger`, `payroll_ledger`, `payment_audit` and `announcements` (DB triggers). CHECK constraints and partial uniques back the invariants (hardening H1–H9).
- **Announcements:** the server-side recipient-count confirmation (stale → 409), the throttle, and the separate fetch so bulk sends never delay time-critical jobs.
- **Complaints:** forward-only state machine with conditional updates and a DB CHECK.

**Gaps**
- **G-A06-1 (Medium — FIXED 2026-10-26):** no WhatsApp message carries a Zoom link any more; they carry the platform join redirect (click logged), only while the join window is open. Residual: joins from the Zoom app or a link copied from `GET /api/sessions` leave no click. Original finding: the T+0 `SESSION_START` WhatsApp carries the raw Zoom join link. Joins from WhatsApp leave no click, so the late-start reminder/alert can be a false positive and the click timeline is incomplete.
- **G-A06-2 (Low):** the announcement confirmation compares counts, not the exact recipient set. There is no server idempotency key (the in-memory cap of 5/hour is the only repeat backstop).
- **G-A06-3 (Info):** Paymob callback shape and HMAC field order are unverified until the sandbox run (the parser is isolated in `parsePaymobCallback`).

## A07 — Authentication Failures

**Evidence**
- **Login rate limit: Verified.** 5 attempts per 10 minutes per username key and per IP key (`lib/auth.ts`, `rateLimitKeys`). There is also a global per-IP limit in `proxy.ts` of 120 requests/min, and change-password is limited to 5 per 10 minutes.
- **Forced password change: Fixed (B4).** An Admin-set password for ADMIN/SUPERVISOR/TEACHER forces a change, and other edits no longer clear the flag. Audit columns `password_set_by_id/at`. The proxy redirects `mustChangePassword` users.
- **Demo passwords:** from env only; the old public literal was removed from the seed.

**Gaps**
- **G-A07-1 (Medium):** rate limits are in-memory (`lib/rate-limit.ts`). They reset on restart and are per-process; with more than one instance they multiply. Acceptable for the single-process deployment the worker already requires; revisit if scaled.
- **G-A07-2 (Low):** no account lockout or MFA for Admin/Supervisor (not in scope; consider for launch).
- **G-A07-3 (Info):** minimum password length differs between Admin-created profiles (12) and the app/self-service flow (8, owner decision). Not a vulnerability; noted for consistency.

## A08 — Software or Data Integrity Failures

**Evidence**
- Webhook signatures are verified before any parsing is trusted (both providers).
- Ledgers are append-only. Money moves in single transactions with DB uniques as idempotency backstops.
- The payment audit trail is written fail-closed with PAID.
- The seed copies settlement in transactions; the CHECKs reject inconsistent rows.

**Gap**
- **G-A08-1 (Low):** no CI integrity steps (signed builds, `npm ci --ignore-scripts` policy) — deploy concern.

## A09 — Security Logging & Alerting Failures

**Evidence (all 32 log calls in `app/` and `lib/` read on 2026-10-26)**
- Logs carry ids, counts, codes and field names only.
- No passwords, tokens, phone numbers, message bodies, Zoom links or file URLs.
- The Paymob webhook logs field NAMES for unexpected shapes, never values. The OpenWA status logs the status word only.
- Business alerting goes through the notification jobs: `PAYMENT_ANOMALY`, `BALANCE_NEGATIVE`, `SETTLED_WITHOUT_SUBSCRIPTION`, late-start Admin alert, teacher flags.

**Gaps**
- **G-A09-1 (Medium):** the worker's catch blocks log `cause.message`. Prisma error messages can include constraint/field details, and potentially values in some error kinds. Recommendation: log the error class/code only.
- **G-A09-2 (Medium):** no central error monitoring/alerting (console only). The deploy checklist launch gaps cover it: e.g. Sentry with PII scrubbing; alert on webhook 5xx and FAILED-job spikes.
- **G-A09-3 (Low):** there is no admin-visible security event log (failed logins, 403 spikes).

## A10 — Mishandling of Exceptional Conditions

**Evidence**
- **Fail closed:** same-origin (missing `ALLOWED_ORIGINS` → 403), webhook secrets (missing → 401), the finance wall, the visibility layer (null → 404).
- **Readiness probes:** cache only positive results, so the app degrades instead of crashing before migrations are applied (Phase 6b, attachments, Phase 7).
- **Worker:** each tick step is isolated in try/catch; stale PROCESSING jobs are marked FAILED (never re-sent); transient vs permanent provider errors; send-time re-checks (session state, clicks).
- **Webhook:** malformed signed bodies are recorded and get 200 (no infinite retries); DB faults → 500 → provider retry (idempotent).
- **Payment audit** best-effort where observability must not change the outcome; fail-closed where it accompanies money.

**Gap**
- **G-A10-1 (Low):** client components show raw server `error.message` strings (English) in some panels. They are not sensitive, but are an i18n/UX gap.

---

## Summary of owner actions (security)
1. ~~Upgrade `next` ≥ 16.4.3, `prisma` 7.10.1, `zod` ≥ 4.6.6 — G-A03-1/2~~ — done 2026-10-26 (next 16.4.3 + eslint-config-next 16.4.3, prisma/@prisma/client/@prisma/adapter-pg 7.10.1, zod 4.6.7; each step tsc/lint/build exit 0). Remaining `npm audit`: 1 moderate (`fast-uri`, transitive, `npm audit fix` available — not run, report only).
2. ~~Decide on the WhatsApp start message link (G-A06-1)~~ — done 2026-10-26.
3. Baseline headers added 2026-10-26; CSP/HSTS/Permissions-Policy before launch (G-A02-1).
4. Set `ALLOWED_ORIGINS` correctly in production and test change-password behind the real proxy (G-A02-2/3).
5. Encryption of application details/phones/Zoom links (G-A04-1, launch list).
6. Error monitoring with PII scrubbing; trim `cause.message` logging (G-A09-1/2).
7. Decide whether an Admin may create a minor without a guardian (G-A01-1).

## Phase 8 automated OWASP tests and new findings (2026-10-26)

**New findings (severity, status):**
- **G-A07-4 (Medium — FIXED):** credentials could appear in URLs. The login, change-password and two Admin create-user forms had no `method`; a submit before hydration is a native GET that puts `username`/`password` (named fields) in the query string → browser history, server/proxy logs, `Referer`. Fix: `method="post"` on all four forms. Test: `__tests__/lib/credentials-not-in-url.test.tsx`.
- **G-A10-2 (Medium — FIXED):** 10 route handlers answered **500** for a malformed id (PostgreSQL refused the uuid cast): admin profiles/users PATCH, teacher context, application GET/approve/review, invoice checkout/confirm, session join, subject PATCH. Fix: shared `isUuidParam` → 400 (join: generic 404). Test: `edge-cases.test.ts` VAL-01 sweeps EVERY `[id]` route with three hostile ids.
- **G-A10-3 (Low — FIXED):** payroll adjustment/disbursement amounts beyond the 32-bit column answered 500 → now 400. Test: `payroll-money.test.ts` PAY-05.
- **G-A01-3 (Low — FIXED):** `GET /api/subjects` listed active subjects of EVERY academy to anyone (and to signed-in Admins of other academies). Fix: signed-in → own academy; anonymous → the public application academy. Test: `owasp.test.ts` OW-A01-4.
- **G-A01-4 (Low — FIXED):** two mutation routes answered `FORBIDDEN` instead of `ORIGIN_NOT_ALLOWED` on a cross-origin request (still refused). Fix: shared `requireSameOrigin`. Test: `same-origin-guard.test.ts`.
- **G-A02-5 (Low — OPEN, owner decision):** Next.js sends `X-Powered-By: Next.js` (framework disclosure). Proposal: `poweredByHeader: false` in `next.config.ts`.

**Automated tests per category (all in `webapp/__tests__`, real dev DB, per-run test academies):**

| Category | Automated tests |
|---|---|
| A01 Broken access control (incl. IDOR, SSRF) | `owasp.test.ts` OW-A01-0..4 (every handler has a role guard; unauthenticated sweep; role matrix derived from each handler's own role list — every other role gets 403; money routes Admin-only; subjects tenancy); `same-origin-guard.test.ts` (every mutation × missing/foreign/wrong-port Origin → 403 before any session lookup); cross-academy 404s in `manual-payment`, `phase7-visibility`, `payroll-money`, `reports`, `sessions`; complaints/evaluations/click-timeline visibility in `phase7-visibility.test.ts`; SSRF/open redirect: the join redirect only goes to validated Zoom URLs (`zoom-url.test.ts`, `phase4-live-links.test.ts`, `sessions.test.ts`); webhooks never fetch URLs |
| A02 Misconfiguration | `owasp.test.ts` OW-A02-1 (security headers on every path) |
| A03 Supply chain | not automated (manual: `npm audit` before launch; `fast-uri` deferred) |
| A04 Crypto | `owasp.test.ts` OW-A04-1 (bcrypt cost ≥ 12 everywhere), OW-A04-2 (constant-time webhook signature compare); `payments-webhook.test.ts` WH-07, `whatsapp-delivery.test.ts` WA-01 (bad/missing signature → 401, nothing stored) |
| A05 Injection | `edge-cases.test.ts` VAL-02 (injection/RTL strings stored literally), VAL-01 (injection-looking ids); `evaluations.test.ts` EV-04 (HTML/Arabic stored literally) |
| A06 Insecure design | idempotency/double-spend: `reports.test.ts`, `payments-webhook.test.ts` WH-02/03/12, `manual-payment.test.ts` MP-02/03, `payroll-money.test.ts` PAY-02..04, OT-02; rollback: reports "settlement rollback", WH-08 |
| A07 Authentication | `auth-rbac.test.ts` (username+IP rate limit, inactive users, forced password change), `credentials-not-in-url.test.tsx` |
| A08 Integrity | append-only: PAY-08 (payroll), AN (announcements), PA-06 still manual for payment_audit via cleanup exception only; signed webhooks WH-*, WA-* |
| A09 Logging | `owasp.test.ts` OW-A09-1 (no log statement interpolates passwords/phones/tokens/secrets/links/bodies); `messaging-provider.test.ts` MSG-04/05; announcements AN-09 |
| A10 Exceptional conditions | `edge-cases.test.ts` VAL-01/VAL-03 (no 500 on malformed ids or hostile/huge bodies); `owasp.test.ts` OW-A10-1 (error bodies carry no stack/SQL/Prisma text); DB-timeout behaviour documented (phase-08 "Decision: transaction timeouts") |

**Manual checklist (not automatable here):**
- [ ] CSP (report-only first), HSTS, Permissions-Policy on the real host (deploy-checklist §8).
- [ ] `ALLOWED_ORIGINS` exact values on the production host; change-password behind the real proxy (G-A02-3).
- [ ] `npm audit` clean (or accepted) before launch; `fast-uri` moderate.
- [ ] Secrets rotated before real data; production `NEXTAUTH_SECRET` new; no `SEED_*` on the host.
- [ ] Paymob processed-callback URL + HMAC verified in the sandbox (G-A06-3); OpenWA webhook secret registered.
- [ ] Backup/restore drill; error monitoring with PII scrubbing (G-A09-2).
- [ ] Browser check: a password manager/autofill + slow network login never shows credentials in the address bar.
- [ ] Admin/Supervisor MFA or lockout decision (G-A07-2).
