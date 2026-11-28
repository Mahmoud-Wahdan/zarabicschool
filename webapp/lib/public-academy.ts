import "server-only";

import { toInternationalDigits } from "./messaging/phone";

const DEFAULT_MONTHLY_8_LESSONS_EGP = "2200";
const DEFAULT_MONTHLY_8_LESSONS_USD = "40";
const DEFAULT_PER_LESSON_EGP = "275";
const DEFAULT_PER_LESSON_USD = "5";

function parsePositiveAmount(raw: string | undefined, fallback: string) {
  const value = raw?.trim() || fallback;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatCurrency(raw: string | undefined, currency: "EGP" | "USD", locale: string) {
  const amount = parsePositiveAmount(raw, "");
  if (amount === null) return null;

  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export type PublicPlanPrice = {
  egp: string | null;
  usd: string | null;
  egpAmount: number | null;
  usdAmount: number | null;
};

export function getPublicPlanPrices(locale: string): PublicPlanPrice[] {
  const monthlyEgpRaw = process.env.SITE_MONTHLY_8_LESSONS_PRICE_EGP?.trim() || DEFAULT_MONTHLY_8_LESSONS_EGP;
  const monthlyUsdRaw = process.env.SITE_MONTHLY_8_LESSONS_PRICE_USD?.trim() || DEFAULT_MONTHLY_8_LESSONS_USD;
  const perLessonEgpRaw = process.env.SITE_PER_LESSON_PRICE_EGP?.trim() || DEFAULT_PER_LESSON_EGP;
  const perLessonUsdRaw = process.env.SITE_PER_LESSON_PRICE_USD?.trim() || DEFAULT_PER_LESSON_USD;

  return [
    {
      egp: formatCurrency(monthlyEgpRaw, "EGP", locale),
      usd: formatCurrency(monthlyUsdRaw, "USD", locale),
      egpAmount: parsePositiveAmount(monthlyEgpRaw, DEFAULT_MONTHLY_8_LESSONS_EGP),
      usdAmount: parsePositiveAmount(monthlyUsdRaw, DEFAULT_MONTHLY_8_LESSONS_USD),
    },
    {
      egp: formatCurrency(perLessonEgpRaw, "EGP", locale),
      usd: formatCurrency(perLessonUsdRaw, "USD", locale),
      egpAmount: parsePositiveAmount(perLessonEgpRaw, DEFAULT_PER_LESSON_EGP),
      usdAmount: parsePositiveAmount(perLessonUsdRaw, DEFAULT_PER_LESSON_USD),
    },
  ];
}

export function getPublicMonthlyPlanDefaults(locale: string) {
  const amount = parsePositiveAmount(process.env.SITE_MONTHLY_8_LESSONS_PRICE_EGP, DEFAULT_MONTHLY_8_LESSONS_EGP) ?? 2200;
  return {
    name: locale === "ar" ? "باقة شهرية من ٨ حصص" : "Monthly 8-lesson package",
    amountMinor: String(Math.round(amount * 100)),
    sessions: 8,
  };
}

export function getPublicBusinessContact(locale: string, whatsapp: string | null) {
  const phone = toInternationalDigits(process.env.SITE_CONTACT_PHONE)
    ?? (whatsapp ? new URL(whatsapp).pathname.slice(1) : null);
  const location = locale === "ar"
    ? process.env.SITE_BUSINESS_LOCATION_AR?.trim() || "قويسنا، المنوفية، مصر"
    : process.env.SITE_BUSINESS_LOCATION_EN?.trim() || "Quesna, Menoufia, Egypt";

  return {
    email: process.env.SITE_CONTACT_EMAIL?.trim() || "zarabics@gmail.com",
    phone: phone ? `+${phone}` : null,
    location,
  };
}
