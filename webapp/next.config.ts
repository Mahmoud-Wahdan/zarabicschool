import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import createNextIntlPlugin from "next-intl/plugin";

dotenvConfig({ path: resolve(__dirname, "../.env") });

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["192.168.1.7"],
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
