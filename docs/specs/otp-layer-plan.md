# OTP Verification Layer Plan (WhatsApp, Email, SMS)

**Status:** Proposed (for future implementation)  
**Scope:** `webapp/` authentication, account verification, and password recovery

## 1. Goals & Use Cases
Add a unified, channel-agnostic One-Time Password (OTP) layer supporting **WhatsApp**, **Email**, and **SMS** for:
1. **Login 2FA / Passwordless OTP Sign-In** (optional per-role or user-enabled 2FA, or fallback sign-in).
2. **Contact Verification** when a user adds/updates their `phone` or `email` in `/account`.
3. **Self-Service Password Reset** without requiring manual Admin intervention.

---

## 2. Database Schema (Prisma)
Add an `OtpChallenge` model and enums to `webapp/prisma/schema.prisma`:

```prisma
enum OtpChannel {
  WHATSAPP
  EMAIL
  SMS
}

enum OtpPurpose {
  LOGIN
  VERIFY_PHONE
  VERIFY_EMAIL
  PASSWORD_RESET
}

model OtpChallenge {
  id           String     @id @default(uuid()) @db.Uuid
  academyId    String     @map("academy_id") @db.Uuid
  userId       String?    @map("user_id") @db.Uuid
  channel      OtpChannel
  purpose      OtpPurpose
  destination  String     // Normalized E.164 phone (+...) or lowercase email
  codeHash     String     @map("code_hash") // HMAC-SHA256(code, OTP_SECRET)
  attempts     Int        @default(0)
  maxAttempts  Int        @default(5) @map("max_attempts")
  expiresAt    DateTime   @map("expires_at") @db.Timestamptz(6)
  consumedAt   DateTime?  @map("consumed_at") @db.Timestamptz(6)
  createdAt    DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([destination, purpose, createdAt])
  @@index([userId, purpose])
  @@map("otp_challenges")
}
```

Also consider adding `phoneVerifiedAt DateTime?` and `emailVerifiedAt DateTime?` on `User` for verified-contact tracking.

---

## 3. Delivery Channels Architecture
Create a unified dispatcher `webapp/lib/otp/sender.ts` implementing:
```ts
export interface OtpSender {
  send(destination: string, code: string, locale: "ar" | "en", purpose: OtpPurpose): Promise<void>;
}
```

1. **WhatsApp (`OtpChannel.WHATSAPP`)**
   - Reuse the existing OpenWA adapter (`toWhatsAppChatId` + outbound queue / direct send).
   - High priority: bypass non-urgent announcement queues so OTPs arrive within seconds.
   - Localized template (`ar` / `en`) stating the 6-digit code, 5-minute expiry, and warning not to share it.
2. **Email (`OtpChannel.EMAIL`)**
   - Provider: SMTP (`nodemailer`) or transactional API (Resend / Postmark) configured via `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.
   - Clean bilingual HTML + plain-text email template.
3. **SMS (`OtpChannel.SMS`)**
   - Provider adapter interface (`SMS_PROVIDER`: e.g. `twilio`, `infobip`, or local Egyptian aggregator like `victorylink` for `+20` numbers with international fallback).
   - Configured via `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_FROM`.
   - Keep SMS as an explicit fallback or user-selectable option (due to per-SMS cost vs. free WhatsApp/Email).

---

## 4. Security, Generation & Rate Limiting
- **Code Generation:** 6-digit numeric code using `crypto.randomInt(100000, 1000000)`.
- **Storage:** Never store plaintext OTPs. Store `HMAC-SHA256(code, process.env.OTP_SECRET)` (or `NEXTAUTH_SECRET` fallback) and compare with `crypto.timingSafeEqual`.
- **Expiration & Single-Use:** 5-minute TTL (`expiresAt = now + 5m`). Mark `consumedAt = now()` atomically inside a Prisma transaction on successful verification.
- **Resend / Brute-Force Guards:**
  - Invalidate previous active challenges for the same `(destination, purpose)` when issuing a new code.
  - Cooldown: 60 seconds between requests for the same destination.
  - Hourly cap: max 5 OTP requests per destination/hour and max 10 per IP/hour.
  - Verification cap: lock challenge after `maxAttempts` (5) wrong tries.
  - Reuse `getClientIp` and the pattern in `webapp/lib/auth/login-throttle.ts`.
- **No Account Enumeration:** On `LOGIN` and `PASSWORD_RESET`, return a generic `200 OK` response even if the destination is not registered (only actually dispatch when a matching active user exists).

---

## 5. API Endpoints & NextAuth Integration
1. `POST /api/auth/otp/request`
   - Body: `{ identifier, channel: "WHATSAPP" | "EMAIL" | "SMS", purpose }`
   - Validates `same-origin`, normalizes `identifier` (email lowercase or `toInternationalDigits`), checks rate limits, creates `OtpChallenge`, dispatches via `sender.ts`.
2. `POST /api/auth/otp/verify`
   - Body: `{ challengeId | identifier, code, purpose }`
   - Verifies hash, expiry, attempts, marks `consumedAt`.
   - For `VERIFY_PHONE` / `VERIFY_EMAIL`: updates `User.phoneVerifiedAt` / `User.emailVerifiedAt`.
   - For `PASSWORD_RESET`: issues a short-lived signed reset token or allows setting `newPassword` directly in the verified step.
3. **NextAuth (`webapp/lib/auth.ts`)**:
   - Add a second `CredentialsProvider` (`id: "otp"`) or extend `authorize` to accept `{ identifier, otpCode }` when `OTP_LOGIN_ENABLED=true`.
   - Increment `sessionVersion` on password reset so old sessions are revoked.

---

## 6. UI / UX Flows
- **Login Page (`webapp/app/[locale]/login/login-form.tsx`):**
  - Add a toggle/tab: *"Sign in with Password"* vs *"Sign in with OTP"*.
  - Channel selector pills: **WhatsApp**, **Email**, **SMS** (showing only channels configured in env).
  - 6-digit OTP input (`dir="ltr"`, `inputMode="numeric"`, `autoComplete="one-time-code"`) with a 60s countdown resend button.
- **Forgot Password (`/forgot-password`):**
  - Enter username / phone / email → pick channel → verify 6-digit OTP → set new password.
- **Account Page (`/account`):**
  - "Verify" badge next to `phone` and `email` triggering `VERIFY_PHONE` / `VERIFY_EMAIL` OTP modal.

---

## 7. Phased Rollout
1. **Phase 1:** Schema migration (`otp_challenges`), `lib/otp/` core (generation, HMAC hashing, rate limiter), and WhatsApp sender (zero external cost, uses existing OpenWA).
2. **Phase 2:** Email sender (SMTP/Resend) + Contact verification in `/account` + Forgot Password flow.
3. **Phase 3:** SMS provider integration + OTP sign-in / 2FA option on `/login` + Jest unit tests & Playwright E2E tests.
