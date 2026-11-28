import type { MetadataRoute } from "next";

import { getSiteOrigin } from "../lib/seo";

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/*/admin/",
          "/*/supervisor/",
          "/*/teacher/",
          "/*/student/",
          "/*/guardian/",
          "/*/account/",
          "/*/change-password/",
          "/*/notifications/",
          "/*/announcements/",
          "/*/complaints/",
          "/*/join-status/",
          "/*/payments/",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
