import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import createNextIntlPlugin from "next-intl/plugin";

dotenvConfig({ path: resolve(__dirname, ".env") });

import type { NextConfig } from "next";

import { devAllowedOrigins } from "./lib/config/dev-origins";

/**
 * HSTS for production builds only (read at `next build`; browsers ignore it over http).
 * deploy-checklist §8: start short (HSTS_MAX_AGE, default 300 s) and raise it to
 * 63072000 once every host and subdomain is HTTPS-only — a long value is hard to undo.
 */
function hstsHeader() {
  if (process.env.NODE_ENV !== "production") return [];
  // Empty (as in .env.example) means the default; "0" would switch HSTS off.
  const maxAge = Number(process.env.HSTS_MAX_AGE?.trim() || "300");
  const value = Number.isInteger(maxAge) && maxAge > 0 ? maxAge : 300;
  return [{ key: "Strict-Transport-Security", value: `max-age=${value}` }];
}

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // No "X-Powered-By: Next.js" header (framework disclosure; owner, 2026-10-27,
  // security-review G-A02-5).
  poweredByHeader: false,
  // Dev tunnel host = the APP_PUBLIC_URL host (M-3, 2026-10-27), never hard-coded.
  allowedDevOrigins: devAllowedOrigins(),
  // Security headers on every response (owner, 2026-10-26; G-A02-1 completed
  // 2026-10-29). The page CSP is set per request in proxy.ts (it carries a nonce).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app never frames its own pages; nobody else may frame them (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Browser features the app never uses (the clipboard stays: copy buttons).
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
          ...hstsHeader(),
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
