import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import createNextIntlPlugin from "next-intl/plugin";

dotenvConfig({ path: resolve(__dirname, ".env") });

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
allowedDevOrigins: ['towable-churrigueresque-rod.ngrok-free.dev'],
  // Safe baseline security headers on every response (owner, 2026-10-26). No CSP
  // and no HSTS yet — both are launch-phase items in docs/specs/deploy-checklist.md.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app never frames its own pages; nobody else may frame them (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
