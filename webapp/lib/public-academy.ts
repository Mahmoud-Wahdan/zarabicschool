import "server-only";

import { toInternationalDigits } from "./messaging/phone";

function formatEgp(raw: string | undefined, locale: string) {
  const value = raw?.trim();
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;

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
    formatEgp(process.env.SITE_MONTHLY_8_LESSONS_PRICE_EGP?.trim() || "2200", locale),
    formatEgp(process.env.SITE_PER_LESSON_PRICE_EGP?.trim() || "275", locale),
  ];
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
