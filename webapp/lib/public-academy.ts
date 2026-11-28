import "server-only";

import { toInternationalDigits } from "./messaging/phone";

const DEFAULT_MONTHLY_8_LESSONS_EGP = "2200";
const DEFAULT_PER_LESSON_EGP = "275";

function parsePositiveAmount(raw: string | undefined, fallback: string) {
  const value = raw?.trim() || fallback;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatEgp(raw: string | undefined, locale: string) {
  const amount = parsePositiveAmount(raw, "");
  if (amount === null) return null;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EGP",
    currencyDisplay: "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function getPublicPlanPrices(locale: string) {
  return [
    formatEgp(process.env.SITE_MONTHLY_8_LESSONS_PRICE_EGP?.trim() || DEFAULT_MONTHLY_8_LESSONS_EGP, locale),
    formatEgp(process.env.SITE_PER_LESSON_PRICE_EGP?.trim() || DEFAULT_PER_LESSON_EGP, locale),
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
