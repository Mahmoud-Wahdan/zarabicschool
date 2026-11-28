import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Cairo, Inter, Montserrat, Tajawal } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "../globals.css";
import { routing } from "../../i18n/routing";
import { getAuthSession, getSessionUserId } from "../../lib/dal";
import { countUnread } from "../../lib/notifications/inbox";
import { buildPublicMetadata, getSiteUrl } from "../../lib/seo";
import { BadgeProvider } from "../_components/notifications/badge-provider";

const cairo = Cairo({
  preload: false,
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
});

const tajawal = Tajawal({
  variable: "--font-tajawal",
  weight: ["400", "500", "700"],
  subsets: ["arabic"],
});

const montserrat = Montserrat({
  preload: false,
  variable: "--font-montserrat",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const tBrand = await getTranslations({ locale, namespace: "brand" });
  const tLanding = await getTranslations({ locale, namespace: "minimalLanding" });
  const isAr = locale === "ar";

  const title = isAr
    ? `${tBrand("name")} | أكاديمية تعليم العربية والقرآن الكريم مباشرة عبر Zoom`
    : `${tBrand("name")} | Live Online Arabic & Quran Academy on Zoom`;
  const description = tLanding("intro");
  const base = buildPublicMetadata({
    locale,
    path: "/",
    title,
    description,
    keywords: isAr
      ? ["المدرسة العربية", "Zarabicschool", "تعليم اللغة العربية أونلاين", "تحفيظ القرآن الكريم أونلاين", "حصص عربية مباشرة", "دروس قرآن للأطفال والكبار"]
      : ["Zarabicschool", "learn Arabic online", "online Quran classes", "live Arabic lessons Zoom", "Tajweed classes", "Arabic for kids and adults"],
  });

  return {
    ...base,
    metadataBase: getSiteUrl(),
    title: {
      default: title,
      template: `%s | ${tBrand("name")}`,
    },
  };
}

/** A5: the bell's first count, computed here once per full page load (null = not signed in, or it failed). */
async function initialBadgeCount(user: Awaited<ReturnType<typeof getAuthSession>>): Promise<number | null> {
  if (!user) return null;
  try {
    return await countUnread(user);
  } catch {
    return null; // the provider then asks once from the client
  }
}

export default async function RootLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Only the cookie is read here (no database): the layout streams at once. The count
  // is a promise the bell reads while the page renders (getAuthSession is React-cached,
  // so the page's own auth check shares the same user read).
  const userId = await getSessionUserId();
  const badgeCount = userId ? getAuthSession().then(initialBadgeCount) : null;
  // Dark mode (owner, 2026-10-31): light / dark from the `theme` cookie; anything else
  // follows the device (no attribute). Set here so the first paint is already right.
  const themeCookie = (await cookies()).get("theme")?.value;
  const theme = themeCookie === "dark" || themeCookie === "light" ? themeCookie : undefined;

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-theme={theme}
      className={`${cairo.variable} ${tajawal.variable} ${montserrat.variable} ${inter.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          {/* A5: ONE badge provider per signed-in user; this layout persists across client navigation. */}
          <BadgeProvider key={userId ?? "anonymous"} userId={userId} initialCount={badgeCount}>
            {children}
          </BadgeProvider>
        </NextIntlClientProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
