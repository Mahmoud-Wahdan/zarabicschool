import type { MetadataRoute } from "next";

import { getSiteOrigin } from "../lib/seo";

const PUBLIC_PAGES = [
  { path: "", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/apply", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/service-delivery", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/terms", priority: 0.4, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.4, changeFrequency: "monthly" as const },
  { path: "/refund-policy", priority: 0.4, changeFrequency: "monthly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteOrigin();
  const lastModified = new Date();

  return PUBLIC_PAGES.flatMap(({ path, priority, changeFrequency }) =>
    (["ar", "en"] as const).map((locale) => ({
      url: `${origin}/${locale}${path}`,
      lastModified,
      changeFrequency,
      priority,
      alternates: {
        languages: {
          ar: `${origin}/ar${path}`,
          en: `${origin}/en${path}`,
        },
      },
    })),
  );
}
