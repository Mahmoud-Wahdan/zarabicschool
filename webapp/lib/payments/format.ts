export function formatMoney(amountMinor: bigint | number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(Number(amountMinor) / 100);
}
