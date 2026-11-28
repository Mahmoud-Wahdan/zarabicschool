import type { Metadata } from "next";

const DEFAULT_SITE_URL = "https://zarabicschool.com";

export function getSiteUrl(): URL {
  const raw = process.env.APP_PUBLIC_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || DEFAULT_SITE_URL;
  try {
    return new URL(raw);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

export function getSiteOrigin(): string {
  return getSiteUrl().origin;
}

export function buildPublicMetadata({
  locale,
  path,
  title,
  description,
  keywords,
  noIndex = false,
}: {
  locale: string;
  path: string;
  title: string;
  description: string;
  keywords?: string[];
  noIndex?: boolean;
}): Metadata {
  const normalizedPath = path === "/" ? "" : path;
  const canonicalPath = `/${locale}${normalizedPath}`;
  const arPath = `/ar${normalizedPath}`;
  const enPath = `/en${normalizedPath}`;

  return {
    title,
    description,
    ...(keywords?.length ? { keywords } : {}),
    alternates: {
      canonical: canonicalPath,
      languages: {
        ar: arPath,
        en: enPath,
        "x-default": arPath,
      },
    },
    openGraph: {
      type: "website",
      siteName: "Zarabicschool",
      locale: locale === "ar" ? "ar_EG" : "en_US",
      alternateLocale: locale === "ar" ? ["en_US"] : ["ar_EG"],
      url: canonicalPath,
      title,
      description,
      images: [
        {
          url: "/Brand/minimal-light-hero.png",
          width: 480,
          height: 450,
          alt: "Zarabicschool — Live Arabic & Quran Academy",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/Brand/minimal-light-hero.png"],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
          },
        },
  };
}
